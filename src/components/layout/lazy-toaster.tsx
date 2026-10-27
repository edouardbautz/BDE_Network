'use client';

import dynamic from 'next/dynamic';

// The toasts are shown after an action (a save, a removal), seconds after the page is drawn: the code that draws them is fetched
// once the page is interactive, instead of weighing on the scripts every page loads first.
const Toaster = dynamic(() => import('@/components/ui/sonner').then((module) => module.Toaster), {
  ssr: false,
});

export function LazyToaster() {
  return <Toaster />;
}
