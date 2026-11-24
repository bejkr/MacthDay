import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionState, homeFor } from "@/lib/auth";

async function Entry(): Promise<never> {
  const session = await getSessionState();
  redirect(homeFor(session.state));
}

// Vstupná brána: známe zariadenie ide rovno na prehľad, ostatní na úvodnú obrazovku.
export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
      <Entry />
    </Suspense>
  );
}
