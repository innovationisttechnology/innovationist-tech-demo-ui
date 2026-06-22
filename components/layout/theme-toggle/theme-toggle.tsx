"use client";

import { useTheme } from "next-themes";
import { SunIcon, MoonIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

import styles from "./theme-toggle.module.css";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunIcon weight="bold" className={styles.sunIcon} />
      <MoonIcon weight="bold" className={styles.moonIcon} />
    </Button>
  );
}
