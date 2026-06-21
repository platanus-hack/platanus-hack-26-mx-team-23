import ThemeToggle from "./ThemeToggle";
import styles from "./Nav.module.css";

export default function Nav() {
  return (
    <nav className={styles.nav}>
      <div className={`container ${styles.inner}`}>
        <a href="/" className={styles.logo}>
          <span className={styles.logoMark}>K</span>
          <span className={styles.logoText}>Klai</span>
        </a>

        <div className={styles.links}>
          <a href="#casos" className={styles.link}>Casos de uso</a>
          <a href="#como-usar" className={styles.link}>Cómo funciona</a>
          <a href="#pricing" className={styles.link}>Precio</a>
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
          <ThemeToggle />
          <a
            href="#"
            className={styles.cta}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            Agregar a Chrome
          </a>
        </div>
      </div>
    </nav>
  );
}
