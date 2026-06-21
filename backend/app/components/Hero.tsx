"use client";

import { motion, useReducedMotion } from "motion/react";
import DemoVideo from "./DemoVideo";
import styles from "./Hero.module.css";

const containerVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.2,
    },
  },
};

const strapVariant = {
  hidden: { clipPath: "inset(0 100% 0 0)", opacity: 0 },
  show: {
    clipPath: "inset(0 0% 0 0)",
    opacity: 1,
    transition: { duration: 0.55, ease: [0.7, 0, 0.2, 1] as [number, number, number, number] },
  },
};

const lineVariant = {
  hidden: { y: "110%", opacity: 0 },
  show: {
    y: "0%",
    opacity: 1,
    transition: { type: "spring" as const, stiffness: 110, damping: 18 },
  },
};

const fadeUpVariant = {
  hidden: { y: 20, opacity: 0 },
  show: {
    y: 0,
    opacity: 1,
    transition: { type: "spring" as const, stiffness: 100, damping: 20 },
  },
};

const monitorVariant = {
  hidden: { scale: 0.96, opacity: 0 },
  show: {
    scale: 1,
    opacity: 1,
    transition: { type: "spring" as const, stiffness: 90, damping: 22, delay: 0.25 },
  },
};

export default function Hero() {
  const shouldReduce = useReducedMotion();

  const cv = shouldReduce ? {} : containerVariants;
  const sv = shouldReduce ? { hidden: {}, show: {} } : strapVariant;
  const lv = shouldReduce ? { hidden: {}, show: {} } : lineVariant;
  const fv = shouldReduce ? { hidden: {}, show: {} } : fadeUpVariant;
  const mv = shouldReduce ? { hidden: {}, show: {} } : monitorVariant;

  return (
    <section className={styles.hero}>
      {/* Glow ambiental — uno solo, intencional */}
      <div className={styles.glow} aria-hidden="true" />

      <div className={`container ${styles.inner}`}>
        {/* Columna de texto */}
        <motion.div
          className={styles.textCol}
          variants={cv}
          initial="hidden"
          animate="show"
        >
          {/* Headline — cada línea en su máscara overflow:hidden */}
          <h1 className={styles.headline}>
            <span className={styles.lineWrap}>
              <motion.span className={styles.line} variants={lv}>
                Hablas.
              </motion.span>
            </span>
            <span className={styles.lineWrap}>
              <motion.span className={`${styles.line} ${styles.lineAccent}`} variants={lv}>
                La interfaz
              </motion.span>
            </span>
            <span className={styles.lineWrap}>
              <motion.span className={styles.line} variants={lv}>
                se construye sola.
              </motion.span>
            </span>
          </h1>

          {/* Sub */}
          <motion.p className={styles.sub} variants={fv}>
            Klai es una extensión para Chrome que convierte tus preguntas en
            widgets animados sobre cualquier video — fútbol, series, música.
            En tiempo real, sin menús.
          </motion.p>

          {/* CTAs */}
          <motion.div className={styles.ctas} variants={fv}>
            <a href="#" className={styles.ctaPrimary}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
              Agregar a Chrome — gratis
            </a>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.ctaSecondary}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
              </svg>
              Ver código en GitHub
            </a>
          </motion.div>
        </motion.div>

        {/* Monitor / DemoVideo */}
        <motion.div
          className={styles.monitorCol}
          variants={mv}
          initial="hidden"
          animate="show"
        >
          <DemoVideo />
        </motion.div>
      </div>
    </section>
  );
}
