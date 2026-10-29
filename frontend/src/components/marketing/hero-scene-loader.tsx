'use client';

import dynamic from 'next/dynamic';

const HeroScene = dynamic(() => import('./hero-scene').then((module) => module.HeroScene), {
  ssr: false,
  loading: () => <div className="landing-scene" aria-hidden="true" />,
});

export function HeroSceneLoader() {
  return <HeroScene />;
}
