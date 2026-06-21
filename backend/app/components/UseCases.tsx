"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import styles from "./UseCases.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const cases = [
  {
    emoji: "⚽",
    label: "Fútbol",
    question: "¿Quién va ganando?",
    description:
      "Pregunta en voz alta y Klai genera un marcador animado con el score en vivo. Nunca pierdas el hilo del partido aunque estés en otra app.",
    widget: (
      <div className={styles.widgetScoreboard}>
        <div className={styles.wRow}>
          <span className={styles.wFlag}>🇧🇷</span>
          <span className={styles.wTeam}>Brasil</span>
          <span className={styles.wScore}>3</span>
        </div>
        <div className={styles.wSep}>
          <span className={styles.wMin}>82'</span>
        </div>
        <div className={`${styles.wRow} ${styles.wRowR}`}>
          <span className={styles.wScore}>1</span>
          <span className={styles.wTeam}>Francia</span>
          <span className={styles.wFlag}>🇫🇷</span>
        </div>
      </div>
    ),
  },
  {
    emoji: "🎬",
    label: "Series y películas",
    question: "¿Quién actúa en esta escena?",
    description:
      "Klai identifica el título del episodio desde la pestaña y despliega el elenco, director y datos del show sin que tengas que pausar.",
    widget: (
      <div className={styles.widgetCard}>
        <div className={styles.wCardTop}>
          <div className={styles.wAvatar}>PD</div>
          <div>
            <div className={styles.wCardName}>Pedro Pascal</div>
            <div className={styles.wCardRole}>Joel Miller</div>
          </div>
        </div>
        <div className={styles.wCardSerie}>The Last of Us · S02 E04</div>
      </div>
    ),
  },
  {
    emoji: "🎵",
    label: "Música",
    question: "¿De qué álbum es este tema?",
    description:
      "Detecta la canción en reproducción y muestra álbum, año, BPM y más. Ideal para videos musicales o sets en vivo.",
    widget: (
      <div className={styles.widgetMusic}>
        <div className={styles.wMusicBar}>
          {[40, 80, 55, 90, 65, 100, 70, 45, 85].map((h, i) => (
            <div
              key={i}
              className={styles.wMusicBarItem}
              style={{ height: `${h}%`, animationDelay: `${i * 0.07}s` }}
            />
          ))}
        </div>
        <div className={styles.wMusicName}>Blinding Lights</div>
        <div className={styles.wMusicAlbum}>After Hours · The Weeknd · 2020</div>
      </div>
    ),
  },
  {
    emoji: "🤼",
    label: "Lucha libre",
    question: "¿Cuál fue ese movimiento?",
    description:
      "Identifica finishers, cambios de campeón y estadísticas en tiempo real sobre el stream. Funciona en cualquier federación.",
    widget: (
      <div className={styles.widgetAlert}>
        <div className={styles.wAlertIcon}>⚡</div>
        <div>
          <div className={styles.wAlertTitle}>Sweet Chin Music</div>
          <div className={styles.wAlertSub}>Shawn Michaels · WrestleMania XX</div>
        </div>
      </div>
    ),
  },
];

export default function UseCases() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // Title reveal
      gsap.from(`.${styles.sectionTitle}`, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: `.${styles.sectionTitle}`,
          start: "top 85%",
        },
      });

      // Each case: text reveal + widget parallax
      const caseEls = sectionRef.current?.querySelectorAll(`.${styles.case}`);
      caseEls?.forEach((el) => {
        // Text fade-in
        gsap.from(el.querySelector(`.${styles.caseText}`), {
          y: 50,
          opacity: 0,
          duration: 0.75,
          ease: "power3.out",
          scrollTrigger: {
            trigger: el,
            start: "top 80%",
          },
        });

        // Widget parallax — moves at different rate than text
        gsap.to(el.querySelector(`.${styles.widgetWrap}`), {
          yPercent: -20,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            scrub: 1.5,
          },
        });
      });
    },
    { scope: sectionRef }
  );

  return (
    <section id="casos" className={styles.section} ref={sectionRef}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionBadge}>Casos de uso</div>
          <h2 className={styles.sectionTitle}>
            Funciona con
            <br />
            <span className={styles.accentText}>cualquier contenido</span>
          </h2>
          <p className={styles.sectionSub}>
            El fútbol es el punto de partida, pero la arquitectura es universal.
            Si se puede ver, Klai puede hablar sobre ello.
          </p>
        </div>

        <div className={styles.cases}>
          {cases.map((c, i) => (
            <div
              key={c.label}
              className={`${styles.case} ${i % 2 === 1 ? styles.caseReverse : ""}`}
            >
              <div className={styles.caseText}>
                <span className={styles.caseEmoji}>{c.emoji}</span>
                <span className={styles.caseLabel}>{c.label}</span>
                <h3 className={styles.caseQuestion}>{c.question}</h3>
                <p className={styles.caseDesc}>{c.description}</p>
              </div>

              <div className={styles.widgetWrap}>
                <div className={`glass-panel ${styles.widgetCard_outer}`}>
                  {c.widget}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
