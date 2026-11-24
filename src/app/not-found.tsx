import { Wordmark } from "@/components/nav";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="pitch flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Wordmark className="text-2xl" />
      <p className="num mt-10 text-8xl text-primary">404</p>
      <h1 className="display mt-3 text-3xl text-ink">Mimo ihriska</h1>
      <p className="mt-3 max-w-xs text-muted">Táto stránka neexistuje alebo k nej nemáš prístup.</p>
      <ButtonLink href="/" className="mt-7">Späť do hry</ButtonLink>
    </div>
  );
}
