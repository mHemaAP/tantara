/** Test-harness-only API responses for offline E2E and screenshot review. Never imported by app code. */
export const fixtures={
 user:{id:'fixture-user',name:'Aarav Mehta',email:'advocate@tantara.local',role:'advocate',avatar_initials:'AM',title:'Advocate'},
 summary:{greeting:'Good morning',first_name:'Aarav',today:'2026-10-27',active_cases:12,pending_arbitrations:3,hearings_this_week:2,documents_processed:18,drafts_in_progress:4,tasks_due:3,tasks_overdue:0,is_demo:true},
 activity:[{id:'a1',type:'case_created',actor:'Aarav Mehta',title:'ABC Pvt. Ltd. vs. XYZ Ltd.',case_id:'case-1',at:'2026-10-27T09:20:00+05:30'},{id:'a2',type:'document_added',actor:'Aarav Mehta',title:'Arbitration agreement added',case_id:'case-1',at:'2026-10-26T15:00:00+05:30'}],
 upcoming:[{id:'h1',type:'hearing',title:'Procedural hearing',case_id:'case-1',case_title:'ABC Pvt. Ltd. vs. XYZ Ltd.',at:'2026-10-29T10:00:00+05:30',due_in_days:2},{id:'d1',type:'deadline',title:'Submit statement of claim',case_id:'case-2',case_title:'TechBuild vs. Metro Infra',at:'2026-11-02T17:00:00+05:30',due_in_days:6}],
 cases:{items:[{id:'case-1',title:'ABC Pvt. Ltd. vs. XYZ Ltd.',status:'active'},{id:'case-2',title:'TechBuild vs. Metro Infra',status:'pending'}],total:2,page:1,page_size:20,pages:1},
 jurisdictions:{items:['India','Singapore','England and Wales','International']},
 settings:{profile:{name:'Aarav Mehta',email:'advocate@tantara.local',title:'Advocate'},workspace:{name:'TANTARA Arbitration Workspace',default_jurisdiction:'India',default_seat:'Mumbai',currency:'INR'},ai:{base_url:'http://127.0.0.1:8080/v1',model:'Local model',temperature:0.2,top_k:5},embeddings:{provider:'FastEmbed',model:'all-MiniLM-L6-v2',dims:384,index_size:18},database:{path:'backend/data/tantara.db',rows:148,size_bytes:32768,migrations:'current'},appearance:{theme:'light',density:'comfortable',font:'inter'},security:{sessions:1,audit_events:8},'data/import':{items:[],status:'idle'}}
};
export async function installApiFixtures(page){
 await page.route('http://127.0.0.1:8010/api/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1','');let body={};
  if(path==='/auth/login')body={access_token:'e2e-fixture-token',token_type:'bearer',user:fixtures.user};
  else if(path==='/auth/me')body=fixtures.user;
  else if(path==='/dashboard/summary')body=fixtures.summary;
  else if(path==='/dashboard/activity')body=fixtures.activity;
  else if(path==='/dashboard/upcoming')body=fixtures.upcoming;
  else if(path==='/cases')body=fixtures.cases;
  else if(path==='/cases/case-1/overview')body={id:'case-1',title:'ABC Pvt. Ltd. vs. XYZ Ltd.',status:'active',forum:'SIAC',seat:'Mumbai, India',claimant:'ABC Pvt. Ltd.',respondent:'XYZ Ltd.',participants:[],tasks:[],hearings:[],documents_count:1,drafts_count:0};
  else if(path==='/documents/doc-1')body={id:'doc-1',title:'Arbitration Agreement',document_type:'Arbitration Agreement',status:'ready',jurisdiction:'India',pages:1};
  else if(path==='/documents/doc-1/text')body={text:'Arbitration agreement text for a test workspace.',pages:[{page_number:1,text:'Arbitration agreement text for a test workspace.'}]};
  else if(path==='/documents/doc-1/pages')body={items:[{page_number:1,text:'Arbitration agreement text for a test workspace.',ocr_confidence:0.99}]};
  else if(path==='/meta/jurisdictions')body=fixtures.jurisdictions;
  else if(path==='/ai/status')body={llm:{provider:'local',model:'Local model',reachable:true,latency_ms:42},embeddings:{provider:'fastembed',model:'all-MiniLM-L6-v2',dims:384,ready:true},vector:{backend:'faiss',chunks:18,vectors:18,consistent:true}};
  else if(path==='/ai/ask')body={status:'no_evidence',answer:'The workspace does not contain enough source material to answer this question.',citations:[],follow_ups:[],disclaimer:'For research assistance only.'};
  else if(path.startsWith('/settings/'))body=fixtures.settings[path.replace('/settings/','')]??{};
  else if(path==='/meta/institutions')body={items:['SIAC','ICC','LCIA','DIAC','SIIA','Ad hoc']};
  else if(path==='/ai/sessions'||path==='/documents')body={items:[],total:0,page:1,page_size:20,pages:0};
  else if(path==='/search/documents')body={items:[{document_id:'doc-1',document_title:'Arbitration Agreement',chunk_id:'chunk-1',page_number:1,snippet:'Arbitration agreement text',score:0.9}],total:1,page:1,page_size:20,pages:1};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
}
