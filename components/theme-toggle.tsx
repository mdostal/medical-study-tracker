"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// Light/dark/system toggle (story: dark-mode-and-ui-polish). Persistence and
// "defaults to system preference on first visit" are both handled by
// next-themes itself (localStorage key "theme", same no-accounts posture as
// everything else in this app) — this component is just the control surface,
// same ToggleGroup pattern already used for Sort-by/Currency/Sex elsewhere.
//
// `mounted` guards against a hydration mismatch: next-themes can't know the
// persisted/system theme during SSR, so `theme` is undefined server-side and
// on the very first client render. Rendering nothing (well, an inert
// same-size placeholder) until mounted avoids the toggle briefly showing the
// wrong pressed state or next-themes' own suppressHydrationWarning masking a
// real mismatch elsewhere.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-7 w-[84px]" aria-hidden />;
  }

  return (
    <ToggleGroup
      value={[theme ?? "system"]}
      onValueChange={(v) => {
        const next = v[0];
        if (next) setTheme(next);
      }}
      variant="outline"
      size="sm"
      aria-label="Theme"
    >
      <ToggleGroupItem value="light" aria-label="Light theme" title="Light">
        <Sun className="size-3.5" />
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="System theme" title="System">
        <Monitor className="size-3.5" />
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme" title="Dark">
        <Moon className="size-3.5" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
