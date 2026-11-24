"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export function ReloadButton() {
  // Keď sa spojenie vráti, vrátime používateľa do aplikácie automaticky.
  useEffect(() => {
    const back = () => window.location.replace("/");
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);

  return (
    <Button className="mt-7" onClick={() => window.location.replace("/")} icon={<RefreshCw className="size-4" />}>
      Skúsiť znova
    </Button>
  );
}
