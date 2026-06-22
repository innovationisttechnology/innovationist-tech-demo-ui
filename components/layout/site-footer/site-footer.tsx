import Link from "next/link";
import {
  GithubLogoIcon,
  LinkedinLogoIcon,
  XLogoIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react/dist/ssr";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Container } from "@/components/layout/container/container";

import styles from "./site-footer.module.css";

const footerNav = [
  {
    title: "Services",
    links: [
      { label: "AI & LLM Apps", href: "/services/ai" },
      { label: "Web Platforms", href: "/services/web" },
      { label: "Product Design", href: "/services/design" },
      { label: "Consulting", href: "/services/consulting" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Work", href: "/work" },
      { label: "Blog", href: "/blog" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Case Studies", href: "/work" },
      { label: "Documentation", href: "/docs" },
      { label: "Changelog", href: "/changelog" },
      { label: "Status", href: "/status" },
    ],
  },
] as const;

const socials = [
  { label: "GitHub", href: "https://github.com/innovationisttechnology", Icon: GithubLogoIcon },
  { label: "LinkedIn", href: "https://linkedin.com", Icon: LinkedinLogoIcon },
  { label: "X", href: "https://x.com", Icon: XLogoIcon },
] as const;

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <Container className={styles.inner}>
        <div className={styles.grid}>
          {/* Brand + CTA */}
          <div className={styles.brand}>
            <Link href="/" className={styles.logo}>
              <span className={styles.logoMark}>IT</span>
              <span className={styles.logoText}>InnovationistTech Demos</span>
            </Link>
            <p className={styles.tagline}>
              We design and build modern web platforms and AI products —
              from streaming assistants to real-time dashboards — shipped
              with production discipline.
            </p>
            <Button className={styles.brandCta} size="lg" asChild>
              <Link href="/contact">
                Start a project
                <ArrowRightIcon weight="bold" data-icon="inline-end" />
              </Link>
            </Button>
          </div>

          {/* Link columns */}
          {footerNav.map((column) => (
            <div key={column.title}>
              <h3 className={styles.columnTitle}>{column.title}</h3>
              <ul className={styles.columnList}>
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={styles.columnLink}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Separator className={styles.separator} />

        <div className={styles.bottomBar}>
          <p className={styles.copyright}>
            &copy; {new Date().getFullYear()} Innovationist Technology Group.
            All rights reserved.
          </p>
          <div className={styles.socials}>
            {socials.map(({ label, href, Icon }) => (
              <Button
                key={label}
                variant="ghost"
                size="icon"
                aria-label={label}
                asChild
              >
                <a href={href} target="_blank" rel="noopener noreferrer">
                  <Icon weight="fill" className={styles.socialIcon} />
                </a>
              </Button>
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
}
