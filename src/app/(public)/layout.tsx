import { Wordmark } from "@/components/nav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pitch flex min-h-dvh flex-col items-center px-5 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <Wordmark className="text-2xl" />
      <main className="flex w-full max-w-sm flex-1 flex-col justify-center py-8">{children}</main>
    </div>
  );
}
