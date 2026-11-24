import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/card";
import { ResultScreen } from "../result-page";

export const metadata: Metadata = { title: "Pridať zápas" };

export default function NewMatchPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ResultScreen matchId={null} />
    </Suspense>
  );
}
