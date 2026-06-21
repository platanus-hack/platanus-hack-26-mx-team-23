"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import styles from "./UseCases.module.css";

/* ------------------------------------------------------------------ */
/* Shared transition                                                    */
/* ------------------------------------------------------------------ */

const CARD_TRANSITION = {
  duration: 0.5,
  ease: [0.25, 0.46, 0.45, 0.94] as const,
};

/* ------------------------------------------------------------------ */
/* CardReveal — entra desde abajo, sale con fade                       */
/* ------------------------------------------------------------------ */

function CardReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { amount: 0.2, once: false });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 48, scale: 0.97 }}
      animate={
        isInView
          ? { opacity: 1, y: 0, scale: 1 }
          : { opacity: 0, scale: 0.97 }
      }
      transition={CARD_TRANSITION}
    >
      {children}
    </motion.div>
  );
}

/* ---- Icons ---- */

const IconFootball = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
);
const IconFilm = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="2.18" />
    <line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" /><line x1="2" y1="7" x2="7" y2="7" />
    <line x1="2" y1="17" x2="7" y2="17" /><line x1="17" y1="17" x2="22" y2="17" />
    <line x1="17" y1="7" x2="22" y2="7" />
  </svg>
);
const IconMusic = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
);
const IconWrestling = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);

/* ---- Cases data ---- */

const cases = [
  {
    idx: "01", Icon: IconFootball, label: "Fútbol",
    question: "¿Quién va ganando?",
    description: "Pregunta en voz alta y Klai genera un marcador animado con el score en vivo.",
    img: "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=900&q=85",
    imgAlt: "Estadio de fútbol",
    widget: (
      <div className={styles.widgetScoreboard}>
        <div className={styles.wRow}><span className={styles.wCode}>BRA</span><span className={styles.wScore}>3</span></div>
        <div className={styles.wSep}><span className={styles.wMin}>82&apos;</span></div>
        <div className={`${styles.wRow} ${styles.wRowR}`}><span className={styles.wScore}>1</span><span className={styles.wCode}>FRA</span></div>
      </div>
    ),
    widgetPos: "pos_bottom_right",
  },
  {
    idx: "02", Icon: IconFilm, label: "Series y películas",
    question: "¿Quién actúa en esta escena?",
    description: "Elenco, director y datos del show sin pausar.",
    img: "/tlou-pedro-pascal.jpg", imgAlt: "Pedro Pascal como Joel Miller — The Last of Us",
    widget: (
      <div className={styles.widgetCard}>
        <div className={styles.wCardTop}>
          <div className={styles.wAvatar}>PD</div>
          <div><div className={styles.wCardName}>Pedro Pascal</div><div className={styles.wCardRole}>Joel Miller</div></div>
        </div>
        <div className={styles.wCardSerie}>The Last of Us · S02 E04</div>
      </div>
    ),
    widgetPos: "pos_bottom_right",
  },
  {
    idx: "03", Icon: IconMusic, label: "Música",
    question: "¿De qué álbum es este tema?",
    description: "Álbum, año, BPM y más — sobre cualquier video musical o set en vivo.",
    img: "/concert.avif", imgAlt: "Concierto en vivo",
    widget: (
      <div className={styles.widgetMusic}>
        <div className={styles.wMusicBar}>
          {[40, 80, 55, 90, 65, 100, 70, 45, 85].map((h, i) => (
            <div key={i} className={styles.wMusicBarItem} style={{ height: `${h}%`, animationDelay: `${i * 0.07}s` }} />
          ))}
        </div>
        <div className={styles.wMusicName}>Yellow</div>
        <div className={styles.wMusicAlbum}>Parachutes · Coldplay · 2000 · 88 BPM</div>
      </div>
    ),
    widgetPos: "pos_bottom_right",
  },
  {
    idx: "04", Icon: IconWrestling, label: "Lucha libre",
    question: "¿Cuál fue ese movimiento?",
    description: "Finishers, cambios de campeón y estadísticas en tiempo real.",
    img: "/lucha-wwe.jpg", imgAlt: "WWE RAW — Shawn Michaels",
    widget: (
      <div className={styles.widgetAlert}>
        <div className={styles.wAlertIcon}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <div><div className={styles.wAlertTitle}>Sweet Chin Music</div><div className={styles.wAlertSub}>Shawn Michaels · WWE RAW 2007</div></div>
      </div>
    ),
    widgetPos: "pos_bottom_right",
  },
] as const;

type CaseItem = (typeof cases)[number];

/* ------------------------------------------------------------------ */
/* Static fallback (prefers-reduced-motion)                            */
/* ------------------------------------------------------------------ */

function StaticFallback() {
  return (
    <section id="casos" className={styles.sectionStatic}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            Funciona con<br /><span className={styles.accentText}>cualquier contenido</span>
          </h2>
          <p className={styles.sectionSub}>
            El fútbol es el punto de partida, pero la arquitectura es universal.
            Si se puede ver, Klai puede hablar sobre ello.
          </p>
        </div>
        <div className={styles.staticList}>
          {cases.map((c) => (
            <div key={c.label} className={styles.staticItem}>
              <div className={styles.staticAmbient} style={{ backgroundImage: `url(${c.img})` }} />
              <div className={styles.cardFrame}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.img} alt={c.imgAlt} className={styles.cardImg} loading="lazy" />
                <div className={styles.cardOverlay} />
                <div className={styles.scanlines} aria-hidden />
                <div className={`glass-panel ${styles.widgetFloat} ${styles[c.widgetPos as keyof typeof styles]}`}>{c.widget}</div>
                <div className={styles.cardText}>
                  <div className={styles.cardIndex}>
                    <div className={styles.cardIconTile}><c.Icon /></div>
                    <span className={styles.cardLabel}>{c.idx} — {c.label}</span>
                  </div>
                  <h3 className={styles.cardQuestion}>{c.question}</h3>
                  <p className={styles.cardDesc}>{c.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* CardSection — una sección de 100vh por card                         */
/* ------------------------------------------------------------------ */

function CardSection({ c }: { c: CaseItem }) {
  return (
    <div className={styles.cardSection}>
      <div className={styles.ambientBlur} style={{ backgroundImage: `url(${c.img})` }} />
      <div className={styles.glassExterior} />
      <div className={styles.scrim} />
      <CardReveal className={styles.stage}>
        <div className={styles.cardFrame}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.img} alt={c.imgAlt} className={styles.cardImg} loading="lazy" />
          <div className={styles.cardOverlay} />
          <div className={styles.scanlines} aria-hidden />
          <div className={`glass-panel ${styles.widgetFloat} ${styles[c.widgetPos as keyof typeof styles]}`}>
            {c.widget}
          </div>
          <div className={styles.cardText}>
            <div className={styles.cardIndex}>
              <div className={styles.cardIconTile}><c.Icon /></div>
              <span className={styles.cardLabel}>{c.idx} — {c.label}</span>
            </div>
            <h3 className={styles.cardQuestion}>{c.question}</h3>
            <p className={styles.cardDesc}>{c.description}</p>
          </div>
        </div>
      </CardReveal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main export                                                          */
/* ------------------------------------------------------------------ */

export default function UseCases() {
  const shouldReduce = useReducedMotion();
  if (shouldReduce) return <StaticFallback />;

  return (
    <section id="casos" className={styles.section}>
      <div className={styles.introPart}>
        <h2 className={styles.introTitle}>
          Funciona con<br />
          <span className={styles.accentText}>cualquier contenido</span>
        </h2>
        <p className={styles.introSub}>
          El fútbol es el punto de partida, pero la arquitectura es universal.{" "}
          Si se puede ver, Klai puede hablar sobre ello.
        </p>
      </div>

      {cases.map((c) => (
        <CardSection key={c.label} c={c} />
      ))}
    </section>
  );
}
