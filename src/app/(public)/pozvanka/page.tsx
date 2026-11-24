import type { Metadata } from "next";
import { JoinFlow } from "./join-flow";

export const metadata: Metadata = { title: "Pozvánka" };

// Stránka je zámerne statická: token z adresy (#…) číta až prehliadač a posiela
// ho serveru v tele požiadavky, nie v URL.
export default function InvitePage() {
  return <JoinFlow />;
}
