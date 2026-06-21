import styles from "./Pricing.module.css";

const features = [
  "Uso ilimitado — sin cuotas ni límites de consultas",
  "Sin cuenta, sin datos personales",
  "Funciona en cualquier video y plataforma",
  "4 widgets: marcador, stats, temporizador, alertas",
  "Watch mode: sugerencias proactivas automáticas",
  "Código abierto bajo licencia MIT",
];

export default function Pricing() {
  return (
    <section id="pricing" className={styles.section}>
      <div className="container">
        <div className={styles.header}>
          <h2 className={styles.title}>
            Sin costo.
            <br />
            <span className={styles.accent}>Para siempre.</span>
          </h2>
          <p className={styles.sub}>
            Klai es open source y gratuito. Siempre.
          </p>
        </div>

        <div className={styles.cardWrap}>
          {/* Glow sutil detrás de la card (fuera del overflow:hidden) */}
          <div className={styles.glowBehind} aria-hidden />

          <div className={`glass-panel frame ${styles.card}`}>
            {/* Regla de acento en la parte superior */}
            <div className={styles.accentRule} aria-hidden />

            <div className={styles.cardTop}>
              <div className={styles.plan}>
                <span className={styles.planDot} aria-hidden />
                Gratis
              </div>
              <div className={styles.price}>
                <span className={styles.priceAmount}>$0</span>
                <span className={styles.pricePer}>&nbsp;para siempre</span>
              </div>
            </div>

            <ul className={styles.features}>
              {features.map((f) => (
                <li key={f} className={styles.feature}>
                  <svg
                    className={styles.check}
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>

            <div className={styles.cardActions}>
              <a href="#" className={styles.ctaPrimary}>
                Agregar a Chrome — gratis
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.ctaSecondary}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
                </svg>
                Ver en GitHub
              </a>
            </div>

            <p className={styles.donate}>
              Si Klai te es útil,{" "}
              <a href="#" className={styles.donateLink}>
                considera donarnos un café
              </a>
              . El desarrollo lo mantenemos en nuestro tiempo libre.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
