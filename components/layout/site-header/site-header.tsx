"use client";

import Link from "next/link";
import { useState } from "react";
import { ListIcon, GithubLogoIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container/container";
import { ThemeToggle } from "@/components/layout/theme-toggle/theme-toggle";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import styles from "./site-header.module.css";

const navLinks = [
  { label: "Services", href: "/services" },
  { label: "Work", href: "/work" },
  { label: "About", href: "/about" },
  { label: "Blog", href: "/blog" },
] as const;

const GITHUB_URL = "https://github.com/innovationisttechnology";

function Logo() {
  return (
    <Link href="/" className={styles.logo}>
      <span className={styles.logoMark}>IT</span>
      <span className={styles.logoText}>InnovationistTech Demos</span>
    </Link>
  );
}

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className={styles.header}>
      <Container className={styles.inner}>
        <Logo />

        {/* Desktop navigation */}
        <NavigationMenu className={styles.desktopNav}>
          <NavigationMenuList className={styles.desktopNavList}>
            {navLinks.map((link) => (
              <NavigationMenuItem key={link.href}>
                <NavigationMenuLink asChild>
                  <Link href={link.href} className={styles.desktopNavLink}>
                    {link.label}
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>

        {/* Desktop actions */}
        <div className={styles.desktopActions}>
          <ThemeToggle />
          <Button variant="outline" size="lg" asChild>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <GithubLogoIcon weight="fill" data-icon="inline-start" />
              GitHub
            </a>
          </Button>
        </div>

        {/* Mobile menu */}
        <div className={styles.mobileCluster}>
          <ThemeToggle />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open menu">
                <ListIcon weight="bold" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className={styles.mobileContent}>
              <SheetHeader className={styles.mobileHeader}>
                <SheetTitle asChild>
                  <Logo />
                </SheetTitle>
              </SheetHeader>
              <nav className={styles.mobileNav}>
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className={styles.mobileNavLink}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
              <div className={styles.mobileActions}>
                <Button variant="outline" size="lg" asChild>
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMobileOpen(false)}
                  >
                    <GithubLogoIcon weight="fill" data-icon="inline-start" />
                    GitHub
                  </a>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </Container>
    </header>
  );
}
