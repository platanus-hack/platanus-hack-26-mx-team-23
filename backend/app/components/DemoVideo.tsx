"use client";

import styles from "./DemoVideo.module.css";

export default function DemoVideo() {
  return (
    <div className={styles.monitor}>
      <div className={styles.frame}>
        <div className={styles.videoPlaceholder} aria-hidden>
          <div className={styles.scanlines} />
          <div className={styles.pitchGradient} />

          <div className={styles.mockScoreboard}>
            <div className={styles.mockTeam}>
              <span className={styles.mockCode}>MEX</span>
              <span className={styles.mockScore}>2</span>
            </div>
            <div className={styles.mockDivider}>
              <span className={styles.mockMin}>67&apos;</span>
            </div>
            <div className={`${styles.mockTeam} ${styles.mockTeamRight}`}>
              <span className={styles.mockScore}>1</span>
              <span className={styles.mockCode}>ARG</span>
            </div>
          </div>

          <div className={styles.mockStat}>
            <span className={styles.mockStatLabel}>xG</span>
            <span className={styles.mockStatValue}>2.4</span>
          </div>
        </div>

        <div className={styles.playOverlay}>
          <button className={styles.playBtn} aria-label="Reproducir demo">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          <p className={styles.playLabel}>Demo próximamente</p>
        </div>

        <div className={styles.shine} aria-hidden />
      </div>
    </div>
  );
}
