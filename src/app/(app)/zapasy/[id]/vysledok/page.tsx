import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/card";
import { ResultScreen } from "../../result-page";

export const metadata: Metadata = { title: "Výsledok zápasu" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResultScreen matchId={id} />;
}

export default function ResultPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}
