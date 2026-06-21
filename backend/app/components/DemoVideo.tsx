"use client";

import styles from "./DemoVideo.module.css";

export default function DemoVideo() {
  return (
    <div className={`glass-panel ${styles.frame}`}>
      {/* Fake video content background */}
      <div className={styles.videoPlaceholder} aria-hidden>
        <div className={styles.scanlines} />
        {/* Simulated stadium/pitch gradient */}
        <div className={styles.pitchGradient} />

        {/* Mock widget overlay — scoreboard */}
        <div className={styles.mockScoreboard}>
          <div className={styles.mockTeam}>
            <span className={styles.mockFlag}>🇲🇽</span>
            <span className={styles.mockName}>México</span>
            <span className={styles.mockScore}>2</span>
          </div>
          <div className={styles.mockDivider}>
            <span className={styles.mockMin}>67'</span>
          </div>
          <div className={`${styles.mockTeam} ${styles.mockTeamRight}`}>
            <span className={styles.mockScore}>1</span>
            <span className={styles.mockName}>Argentina</span>
            <span className={styles.mockFlag}>🇦🇷</span>
          </div>
        </div>

        {/* Mock widget — stat chip */}
        <div className={styles.mockStat}>
          <span className={styles.mockStatLabel}>xG</span>
          <span className={styles.mockStatValue}>2.4</span>
        </div>
      </div>

      {/* Play button overlay */}
      <div className={styles.playOverlay}>
        <button className={styles.playBtn} aria-label="Reproducir demo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <p className={styles.playLabel}>Demo próximamente</p>
      </div>

      {/* Glass edge shine */}
      <div className={styles.shine} aria-hidden />
    </div>
  );
}
