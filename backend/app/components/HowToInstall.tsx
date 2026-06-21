"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import styles from "./HowToInstall.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const steps = [
  {
    n: "01",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "La interfaz se genera sola",
    desc: "Un widget animado aparece sobre el video con exactamente la información que pediste. Sin menús, sin clics extra.",
  },
];

export default function HowToInstall() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.from(`.${styles.header}`, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: `.${styles.header}`,
          start: "top 85%",
        },
      });

      gsap.from(`.${styles.step}`, {
        y: 50,
        opacity: 0,
        duration: 0.65,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: {
          trigger: `.${styles.grid}`,
          start: "top 80%",
        },
      });
    },
    { scope: sectionRef }
  );

  return (
    <section id="como-usar" className={styles.section} ref={sectionRef}>
      <div className="container">
        <div className={styles.header}>
          <div className={styles.badge}>Cómo funciona</div>
          <h2 className={styles.title}>
            Listo en{" "}
            <span className={styles.accent}>cuatro pasos</span>
          </h2>
          <p className={styles.sub}>
            De cero a tu primera UI generativa en menos de dos minutos.
          </p>
        </div>

        <div className={styles.grid}>
          {steps.map((s) => (
            <div key={s.n} className={`glass-panel ${styles.step}`}>
              <div className={styles.stepNum}>{s.n}</div>
              <div className={styles.stepIcon}>{s.icon}</div>
              <h3 className={styles.stepTitle}>{s.title}</h3>
              <p className={styles.stepDesc}>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
