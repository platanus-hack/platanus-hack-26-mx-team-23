import styles from "./Footer.module.css";

export default function Footer() {
  const year = 2026;
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.left}>
          <a href="/" className={styles.logo}>
            <span className={styles.mark}>K</span>
            <span className={styles.name}>Klai</span>
          </a>
          <p className={styles.tagline}>
            Tu pregunta. La interfaz se genera sola.
          </p>
        </div>

        <div className={styles.links}>
          <div className={styles.linkGroup}>
            <span className={styles.groupLabel}>Producto</span>
            <a href="#casos" className={styles.link}>Casos de uso</a>
            <a href="#como-usar" className={styles.link}>Cómo funciona</a>
            <a href="#pricing" className={styles.link}>Precio</a>
          </div>
          <div className={styles.linkGroup}>
            <span className={styles.groupLabel}>Proyecto</span>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className={styles.link}>GitHub</a>
            <a href="https://klai.pro" className={styles.link}>klai.pro</a>
          </div>
        </div>
      </div>

      <div className={`container ${styles.bottom}`}>
        <span className={styles.copy}>© {year} Klai — MIT License</span>
        <span className={styles.credit}>Hecho con ☕ en Hackathon Platanus 2026</span>
      </div>
    </footer>
  );
}
