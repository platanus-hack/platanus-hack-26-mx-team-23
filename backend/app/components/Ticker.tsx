import styles from "./Ticker.module.css";

const DEFAULT_ITEMS = [
  "UI generativa",
  "¿Quién va ganando?",
  "Elenco al instante",
  "¿De qué álbum es?",
  "Sin menús",
  "Sin clics extra",
  "La interfaz se genera sola",
  "Fútbol · Series · Música · Lucha",
  "Gratis · Open source",
  "Hablas. Klai responde.",
];

interface TickerProps {
  items?: string[];
}

export default function Ticker({ items = DEFAULT_ITEMS }: TickerProps) {
  const allItems = [...items, ...items]; // duplicado para loop sin costura

  return (
    <div className={styles.ticker} aria-hidden="true">
      <div className={`${styles.track} ticker__track`}>
        {allItems.map((item, i) => (
          <span key={i} className={styles.item}>
            <span className={i % 5 === 0 ? styles.keyword : undefined}>
              {item}
            </span>
            <span className={styles.sep}>▪</span>
          </span>
        ))}
      </div>
    </div>
  );
}
