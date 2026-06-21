"use client";

import Image from "next/image";
import { motion } from "motion/react";
import styles from "./Nav.module.css";

export default function Nav() {
  return (
    <div className={styles.navWrap}>
    <motion.nav
      className={styles.nav}
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 20, delay: 0.1 }}
    >
      <div className={`container ${styles.inner}`}>
        <a href="/" className={styles.logo}>
          <Image
            src="/klai-logo.png"
            alt="Klai"
            width={160}
            height={80}
            className={styles.logoImg}
            priority
          />
        </a>

        <div className={styles.links}>
          <a href="#casos" className={styles.link}>Casos de uso</a>
          <a href="#como-usar" className={styles.link}>Cómo funciona</a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            GitHub
          </a>
        </div>

        <div className={styles.actions}>
          <a href="#" className={styles.cta}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            Agregar a Chrome
          </a>
        </div>
      </div>
    </motion.nav>
    </div>
  );
}
