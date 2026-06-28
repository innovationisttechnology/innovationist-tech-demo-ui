import Link from "next/link";
import {
  GithubLogoIcon,
  LinkedinLogoIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react/dist/ssr";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Container } from "@/components/layout/container/container";

import styles from "./site-footer.module.css";

const COMPANY_SITE = "https://innovationisttech.com";

// Marketing pages live on the main company site — the demo links out rather
// than maintaining duplicate routes.
const footerNav = [
  {
    title: "Services",
    links: [
      { label: "Custom Software", href: `${COMPANY_SITE}/#our-services` },
      { label: "AI & Machine Learning", href: `${COMPANY_SITE}/#our-services` },
      { label: "Product Design & UX", href: `${COMPANY_SITE}/#our-services` },
      { label: "DevOps Engineering", href: `${COMPANY_SITE}/#our-services` },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: `${COMPANY_SITE}/#about-us` },
      { label: "Blog", href: `${COMPANY_SITE}/blog` },
      { label: "Contact", href: `${COMPANY_SITE}/contact-us` },
      { label: "From Us", href: `${COMPANY_SITE}/from-us` },
    ],
  },
  {
    title: "Get Started",
    links: [
      {
        label: "Schedule a Call",
        href: `${COMPANY_SITE}/contact-us/schedule-a-call`,
      },
      {
        label: "Let's Build Together",
        href: `${COMPANY_SITE}/contact-us/lets-build-together`,
      },
    ],
  },
] as const;

const CONTACT_EMAIL = "inquiries@innovationisttech.com";
const CONTACT_PHONE = "+1 (943) 267 4613";

const socials = [
  {
    label: "GitHub",
    href: "https://github.com/innovationisttechnology",
    Icon: GithubLogoIcon,
  },
  // TODO: replace with the real Innovationist Tech LinkedIn company page URL.
  { label: "LinkedIn", href: "https://linkedin.com", Icon: LinkedinLogoIcon },
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
            <Button className={styles.brandCta} size="lg" asChild>
              <a href={`${COMPANY_SITE}/contact-us/lets-build-together`}>
                Let&apos;s Build Together
                <ArrowRightIcon weight="bold" data-icon="inline-end" />
              </a>
            </Button>
            <ul className={styles.contactList}>
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className={styles.columnLink}
                >
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li>
                <a
                  href={`tel:${CONTACT_PHONE.replace(/[^+\d]/g, "")}`}
                  className={styles.columnLink}
                >
                  {CONTACT_PHONE}
                </a>
              </li>
            </ul>
          </div>

          {/* Link columns */}
          {footerNav.map((column) => (
            <div key={column.title}>
              <h3 className={styles.columnTitle}>{column.title}</h3>
              <ul className={styles.columnList}>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className={styles.columnLink}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Separator className={styles.separator} />

        <div className={styles.bottomBar}>
          <p className={styles.copyright}>
            &copy; {new Date().getFullYear()} Innovationist Technology
            Solutions. All rights reserved.
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
