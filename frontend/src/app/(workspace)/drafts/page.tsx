'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { draftsApi, type Row } from '@/features/drafts/api';
import '@/features/drafts/styles.css';

const TYPES = ['Statement of Claim','Statement of Defence','Rejoinder','Notice Invoking Arbitration','Request for Arbitration','Procedural Application','Interim Relief Application','Written Submissions','Chronology of Events','List of Dates','Case Summary','Legal Research Memorandum'];
const textOf = (x: any) => typeof x === 'string' ? x : x?.name ?? x?.title ?? x?.label ?? '';
const safeHtml = (value: string) => value.split('\n').map(line => {
  const safe = line.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  return safe.startsWith('# ') ? `<h1>${safe.slice(2)}</h1>` : safe.startsWith('## ') ? `<h2>${safe.slice(3)}</h2>` : safe.startsWith('- ') ? `<p>• ${safe.slice(2)}</p>` : safe ? `<p>${safe}</p>` : '<p><br/></p>';
}).join('');

export default function DraftsPage() {
  const [templates,setTemplates]=useState<Row[]>([]),[cases,setCases]=useState<Row[]>([]),[institutions,setInstitutions]=useState<any[]>([]),[docs,setDocs]=useState<Row[]>([]),[recent,setRecent]=useState<Row[]>([]);
  const [type,setType]=useState(TYPES[0]),[template,setTemplate]=useState(''),[caseId,setCaseId]=useState(''),[institution,setInstitution]=useState(''),[instructions,setInstructions]=useState(''),[selected,setSelected]=useState<string[]>([]);
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[draft,setDraft]=useState<Row|null>(null),[content,setContent]=useState(''),[versions,setVersions]=useState<Row[]>([]),[citations,setCitations]=useState<Row[]>([]),[saving,setSaving]=useState(false);

  useEffect(()=>{
    draftsApi.templates().then(r=>{const rows=r.items??[];setTemplates(rows);setTemplate(String(rows.find(x=>textOf(x.document_type??x.name)===TYPES[0])?.id??''));}).catch(e=>setError(e.message));
    draftsApi.list().then(r=>setRecent(r.items??[])).catch(()=>{});
    draftsApi.cases().then(r=>setCases(r.items??[])).catch(()=>{});
    draftsApi.institutions().then(r=>setInstitutions(Array.isArray(r)?r:r.items??[])).catch(()=>{});
    const id=new URLSearchParams(window.location.search).get('id');
    if(id)draftsApi.get(id).then(d=>{setDraft(d);setContent(d.content_markdown??'');if(d.case_id)setCaseId(d.case_id);}).catch(e=>setError(`Draft could not be opened: ${e.message}`));
  },[]);
  useEffect(()=>{if(caseId)draftsApi.documents(caseId).then(r=>setDocs((r.items??[]).filter(d=>d.status==='ready'))).catch(()=>setDocs([]));},[caseId]);
  useEffect(()=>{if(draft?.id)draftsApi.versions(String(draft.id)).then(r=>setVersions(r.items??[])).catch(()=>{});},[draft?.id]);
  useEffect(()=>{const source=String(draft?.content_markdown??content);if(!source)return;const cited=source.matchAll(/^- \[([^\]]+)\] (.*?), page (\d+)/gm);setCitations(Array.from(cited,([,chunk,title,page])=>({chunk_id:chunk,document_title:title,page_number:Number(page),document_id:docs.find(x=>textOf(x.title??x.filename??x.name)===title)?.id})));},[draft?.content_markdown,content,docs]);

  const generate=async()=>{
    setBusy(true);setError('');setStatus('Preparing a grounded draft from selected case materials…');
    const timer=setTimeout(()=>setStatus('The local model is still drafting. The request will time out after 115 seconds if the service does not respond.'),1800);
    try {
      const promptInstructions=[institution?`Requested institution preference: ${institution}. Verify it against the case record; do not treat this preference as evidence.`:'',instructions].filter(Boolean).join('\n\n');
      const r=await draftsApi.generate({template_id:template||undefined,document_type:type,case_id:caseId,instructions:promptInstructions,source_document_ids:selected});
      const d={...r,id:r.draft_id,title:type,case_id:caseId};setDraft(d);setRecent(rows=>[d,...rows]);setContent(r.content_markdown??'');window.history.replaceState(null,'',`/drafts?id=${r.draft_id}`);
      const cited=(r.content_markdown??'').matchAll(/^- \[([^\]]+)\] (.*?), page (\d+)/gm);
      setCitations(Array.from(cited,([,chunk,title,page])=>({chunk_id:chunk,document_title:title,page_number:Number(page),document_id:docs.find(x=>textOf(x.title??x.filename??x.name)===title)?.id})));
      setStatus(r.status==='no_evidence'?'Insufficient evidence: review the editable template skeleton and add supporting sources.':r.status==='model_unavailable'?'The local model is unavailable. The editable review skeleton is ready for retry.':`Generation state: ${r.status}. Review all marked facts before use.`);
    } catch(e:any) { setError(e.message==='Failed to fetch'?'Draft service unavailable at 127.0.0.1:8115. Check the private API and retry.':`Draft generation failed: ${e.message}`);setStatus(''); }
    finally { clearTimeout(timer);setBusy(false); }
  };
  const save=async()=>{
    if(!draft?.id)return;setSaving(true);
    try { const r=await draftsApi.save(String(draft.id),{content_markdown:content,change_note:'Saved from drafting workspace'});setStatus(`Version ${r.version_number??''} saved.`);const v=await draftsApi.versions(String(draft.id));setVersions(v.items??[]); }
    catch(e:any){setError(`Save failed: ${e.message}`);}finally{setSaving(false);}
  };
  const exportFile=async(format:'docx'|'pdf')=>{
    if(!draft?.id)return;
    try {const base=(process.env.NEXT_PUBLIC_API_BASE_URL??'http://127.0.0.1:8115').replace(/\/$/,'');const resp=await fetch(`${base}/api/v1/drafts/${draft.id}/export?format=${format}`,{headers:{Authorization:`Bearer ${localStorage.getItem('tantara_token')??''}`}});if(!resp.ok)throw new Error(`${resp.status} ${resp.statusText}`);const blob=await resp.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`draft.${format}`;a.click();URL.revokeObjectURL(url);}
    catch(e:any){setError(`Export unavailable: ${e.message}`);}
  };
  const regenerate=async()=>{
    const section=window.prompt('Section heading to regenerate');if(!section||!draft?.id)return;
    try {const r=await draftsApi.regenerateSection(String(draft.id),{section_heading:section,instructions});setContent(r.content_markdown??content);setStatus(`Regenerated section: ${section}. The API marked it for review.`);const v=await draftsApi.versions(String(draft.id));setVersions(v.items??[]);}
    catch(e:any){setError(`Section regeneration failed: ${e.message}`);}
  };
  const restore=async(v:Row)=>{
    if(!draft?.id)return;
    try {const r=await draftsApi.restore(String(draft.id),{content_markdown:v.content_markdown,change_note:`Restored version ${v.version_number}`});setContent(r.content_markdown??v.content_markdown);setStatus(`Version ${v.version_number} restored as a new version.`);const rows=await draftsApi.versions(String(draft.id));setVersions(rows.items??[]);}
    catch(e:any){setError(`Restore failed: ${e.message}`);}
  };
  const institutionItems=institutions.map(textOf).filter(Boolean);

  return <main className="drafts">
    <header className="drafts-head"><div><h1>AI Case Drafts</h1><p>Draft from case evidence, review citations, and keep every version.</p></div><a className="draft-secondary" href="/autofill">Smart Autofill →</a></header>
    {error&&<div className="draft-status error" role="alert">{error} <button className="draft-secondary" onClick={()=>{setError('');void draftsApi.templates().then(r=>setTemplates(r.items??[])).catch(e=>setError(e.message));}}>Retry</button></div>}
    {status&&<div className="draft-status" role="status">{status}{busy&&<div className="draft-progress"><i/></div>}{draft&&/model is unavailable|insufficient evidence/i.test(status)&&<button className="draft-secondary" disabled={busy} onClick={generate} style={{marginLeft:10}}>Retry generation</button>}</div>}
    {!draft ? <><section className="draft-card" style={{marginBottom:18}}><h2>Recent drafts</h2>{recent.length?recent.map((d,i)=><div className="draft-version" key={d.id??i}><span><strong>{d.title??d.document_type??'Untitled draft'}</strong><small>{d.status??'Draft'} · {d.updated_at?new Date(d.updated_at).toLocaleString():'Date unavailable'}</small></span><a className="draft-secondary" href={`/drafts?id=${d.id}`}>Open</a></div>):<p>No drafts yet.</p>}</section><div className="drafts-grid">
      <section className="draft-card"><h2>Start a draft</h2>
        <div className="draft-field"><span className="draft-label">Document type</span><div className="draft-types">{TYPES.map(t=><button key={t} className={`draft-chip ${type===t?'active':''}`} onClick={()=>{setType(t);setTemplate(String(templates.find(x=>textOf(x.document_type??x.name)===t)?.id??''));}}>{t}</button>)}</div></div>
        <div className="draft-field"><label className="draft-label" htmlFor="case">Case</label><select id="case" className="draft-select" value={caseId} onChange={e=>{const id=e.target.value;setCaseId(id);setSelected([]);setInstitution(String(cases.find(c=>String(c.id)===id)?.forum??''));}}><option value="">Choose a case</option>{cases.map(c=><option key={c.id} value={c.id}>{textOf(c.title??c.case_title)}</option>)}</select></div>
        <div className="draft-field"><label className="draft-label" htmlFor="template">Template</label><select id="template" className="draft-select" value={template} onChange={e=>{setTemplate(e.target.value);const t=templates.find(x=>String(x.id)===e.target.value);if(t)setType(textOf(t.document_type??t.name));}}><option value="">Choose template</option>{templates.map(t=><option key={t.id} value={t.id}>{textOf(t.name??t.title??t.document_type)}</option>)}</select></div>
        <div className="draft-field"><label className="draft-label" htmlFor="institution">Institution</label><select id="institution" className="draft-select" value={institution} onChange={e=>setInstitution(e.target.value)}><option value="">Select institution</option>{institutionItems.map(i=><option key={i}>{i}</option>)}</select></div>
        <div className="draft-field"><label className="draft-label" htmlFor="instructions">Drafting instructions</label><textarea id="instructions" className="draft-textarea" value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="Describe the relief, issues, and tone. Missing facts remain marked for review."/></div>
        <div className="draft-foot"><button className="draft-primary" disabled={busy||!caseId||!template} onClick={generate}><Sparkles size={16}/>{busy?'Generating…':'Generate Draft'}</button></div>
      </section>
      <aside className="draft-card"><h2>Supporting sources</h2><p style={{fontSize:12,marginBottom:10}}>Choose ready evidence from the selected case library.</p>{!caseId?<p>Select a case to load its documents.</p>:docs.length?docs.map(d=><label className="draft-source" key={d.id}><input type="checkbox" checked={selected.includes(String(d.id))} onChange={e=>setSelected(e.target.checked?[...selected,String(d.id)]:selected.filter(x=>x!==String(d.id)))}/><span>{textOf(d.title??d.filename??d.name)}<small>{d.status}</small></span></label>):<p>No ready case documents available.</p>}</aside>
    </div></> : <div className="draft-columns">
      <section className="draft-card"><h2>{draft.title??type}</h2>
        <div className="draft-toolbar"><button onClick={()=>document.execCommand('bold')}>Bold</button><button onClick={()=>document.execCommand('italic')}>Italic</button><button onClick={()=>document.execCommand('insertUnorderedList')}>List</button><button onClick={()=>document.execCommand('formatBlock',false,'h2')}>Heading</button><button onClick={()=>document.execCommand('undo')}>Undo</button><button onClick={()=>document.execCommand('redo')}>Redo</button><button className="draft-secondary" onClick={regenerate}>Regenerate section</button></div>
        <div className="draft-editor" contentEditable suppressContentEditableWarning onInput={e=>setContent(e.currentTarget.innerText)} dangerouslySetInnerHTML={{__html:safeHtml(content||'# Draft outline\n\nReview required facts before generation.')}}/>
        <div className="draft-foot"><button className="draft-primary" disabled={saving} onClick={save}>Save version</button><button className="draft-secondary" onClick={()=>exportFile('docx')}>Export DOCX</button><button className="draft-secondary" onClick={()=>exportFile('pdf')}>Export PDF</button></div>
      </section>
      <aside><section className="draft-card"><h2>Cited sources</h2>{citations.length?citations.map((c,i)=><div className="draft-citation" key={i}><a href={c.document_id?`/documents/${c.document_id}?page=${c.page_number}`:'#'}>{c.document_title} · p. {c.page_number}</a><p>Evidence chunk {c.chunk_id}</p></div>):<p>No citations returned by the service.</p>}</section>
        <section className="draft-card" style={{marginTop:16}}><h2>Version history</h2>{versions.length?versions.map((v,i)=><div className="draft-version" key={v.id??i}><span>Version {v.version_number??i+1}<small>{v.change_note??''}</small><small>{v.created_at?new Date(v.created_at).toLocaleString():''}</small></span><button className="draft-secondary" onClick={()=>restore(v)}>Restore</button></div>):<p>No saved versions yet.</p>}</section></aside>
    </div>}
  </main>;
}
