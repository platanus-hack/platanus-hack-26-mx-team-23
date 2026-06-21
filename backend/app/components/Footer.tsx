import Image from "next/image";
import styles from "./Footer.module.css";

export default function Footer() {
  const year = 2026;
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.left}>
          <a href="/" className={styles.logo}>
            <Image
              src="/klai-logo.png"
              alt="Klai"
              width={140}
              height={70}
              className={styles.logoImg}
            />
          </a>
          <p className={styles.tagline}>
            Tu pregunta. La interfaz se genera sola.
          </p>
        </div>

        <div className={styles.links}>
          <div className={styles.linkGroup}>
            <span className={`strap ${styles.groupLabel}`}>Producto</span>
            <a href="#casos" className={styles.link}>Casos de uso</a>
            <a href="#como-usar" className={styles.link}>Cómo funciona</a>
          </div>
          <div className={styles.linkGroup}>
            <span className={`strap ${styles.groupLabel}`}>Proyecto</span>
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
