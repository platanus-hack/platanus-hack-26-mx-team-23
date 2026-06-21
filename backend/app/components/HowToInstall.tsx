"use client";

import { motion, useReducedMotion } from "motion/react";
import styles from "./HowToInstall.module.css";

const steps = [
  {
    n: "01",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    title: "Agrega Klai a Chrome",
    desc: "Un clic en la Chrome Web Store y listo. Sin cuenta, sin tarjeta, sin configuración.",
  },
  {
    n: "02",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    title: "Abre cualquier video",
    desc: "YouTube, Twitch, Disney+, Netflix, cualquier stream. Klai se activa automáticamente.",
  },
  {
    n: "03",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
    title: "Habla o escribe tu pregunta",
    desc: "Activa el micrófono con un clic, o escribe directamente. Klai entiende contexto natural.",
  },
  {
    n: "04",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "La interfaz se genera sola",
    desc: "Un widget animado aparece sobre el video con exactamente la información que pediste. Sin menús, sin clics extra.",
  },
];

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const stepVariants = {
  hidden: { x: -24, opacity: 0 },
  show: {
    x: 0,
    opacity: 1,
    transition: { type: "spring" as const, stiffness: 100, damping: 22 },
  },
};

export default function HowToInstall() {
  const shouldReduce = useReducedMotion();

  return (
    <section id="como-usar" className={styles.section}>
      <div className="container">
        <motion.div
          className={styles.header}
          initial={shouldReduce ? {} : { y: 28, opacity: 0 }}
          whileInView={shouldReduce ? {} : { y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{ type: "spring", stiffness: 100, damping: 20 }}
        >
          <h2 className={styles.title}>
            Listo en{" "}
            <span className={styles.accent}>cuatro pasos</span>
          </h2>
          <p className={styles.sub}>
            De cero a tu primera UI generativa en menos de dos minutos.
          </p>
        </motion.div>

        <motion.div
          className={styles.grid}
          variants={shouldReduce ? {} : containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-15% 0px" }}
        >
          {steps.map((s) => (
            <motion.div
              key={s.n}
              className={`glass-panel frame ${styles.step}`}
              variants={shouldReduce ? {} : stepVariants}
            >
              {/* Numeral fantasma de capítulo */}
              <span className={styles.ghostNum}>{s.n}</span>
              <div className={styles.stepIconTile}>{s.icon}</div>
              <h3 className={styles.stepTitle}>{s.title}</h3>
              <p className={styles.stepDesc}>{s.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
