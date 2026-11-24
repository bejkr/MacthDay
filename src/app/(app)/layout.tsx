import { Suspense } from "react";
import { BottomNavigation, OfflineBanner, Sidebar, TopBar } from "@/components/nav";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Navigácia potrebuje vedieť, kto je prihlásený (názov partie, počet upozornení).
// Číta session, preto je za Suspense – obsah stránky na ňu nečaká.
async function Chrome() {
  const me = await requireMember();
  let adminBadge = 0;
  if (me.isAdmin) {
    const supabase = await createClient();
    const { count } = await supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
    adminBadge = count ?? 0;
  }
  const props = { groupName: me.group.name, seasonName: me.season?.name ?? null, unread: me.unread, adminBadge };
  return (
    <>
      <Sidebar {...props} />
      <TopBar {...props} />
      <BottomNavigation {...props} />
    </>
  );
}

function ChromeFallback() {
  return (
    <>
      <div className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-surface/60 lg:block" />
      <div className="sticky top-0 z-30 h-14 border-b border-line bg-bg lg:hidden" />
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface lg:hidden">
        <div className="h-16" />
      </div>
    </>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:pl-64">
      <Suspense fallback={<ChromeFallback />}>
        <Chrome />
      </Suspense>
      <OfflineBanner />
      <main className="mx-auto w-full max-w-5xl px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-8 lg:pt-9 lg:pb-14">
        {children}
      </main>
    </div>
  );
}
