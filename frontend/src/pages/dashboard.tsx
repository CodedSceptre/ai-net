// src/pages/dashboard.tsx
import React from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { useWallet } from "../hooks/useWallet";
import { useNetworkStats } from "../hooks/useNetworkStats";
import { useAgentRegistry } from "../hooks/useAgentRegistry";
import { DashboardLayout } from "../components/dashboard/DashboardLayout";
import { NetworkStatsWidget } from "../components/dashboard/NetworkStatsWidget";
import { NetworkHealthBadge } from "../components/dashboard/NetworkHealthBadge";
import { RecentTasksTable } from "../components/dashboard/RecentTasksTable";
import { useToast } from "../hooks/useToast";
import {
  Skeleton,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTable,
} from "../components/common/Skeleton";
import styles from "./dashboard.module.css";
import type { NetworkStats } from "../types/api";

/**
 * Context-aware skeleton that mirrors the dashboard layout so there is no
 * layout shift between the loading and loaded states.
 */
export const DashboardSkeleton: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div
      data-testid="dashboard-skeleton"
      aria-busy="true"
      aria-label={t("a11y.loadingDashboard")}
    >
      <section className={styles.kpis}>
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard
            key={i}
            className={styles.kpiSkeleton}
            data-testid="dashboard-kpi-skeleton"
          >
            <Skeleton width="60%" height="0.875rem" />
            <Skeleton width="70%" height="1.75rem" />
            <Skeleton variant="rectangular" width="100%" height="2.5rem" />
          </SkeletonCard>
        ))}
      </section>
      <section className={styles.health}>
        <SkeletonAvatar size={10} />
        <Skeleton width="4rem" height="0.875rem" />
      </section>
      <section className={styles.recentTasks}>
        <h2 className={styles.heading}>{t("page.dashboard.recentTasks")}</h2>
        <SkeletonTable rows={5} columns={4} />
      </section>
    </div>
  );
};

export const DashboardPage: React.FC = () => {
  const { address, connected } = useWallet();
  const { data, loading, error } = useNetworkStats();
  const { agents, loading: agentsLoading } = useAgentRegistry();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation();

  React.useEffect(() => {
    if (error) {
      // i18n.t so the toast uses the current language without re-running the
      // effect on every language change.
      showToast(
        i18n.t("page.dashboard.statsError", {
          error: error.message || String(error),
        }),
        "error",
      );
    }
  }, [error, showToast, i18n]);

  // Redirect unauthenticated users using React Router to preserve SPA state
  if (!connected) {
    return <Navigate to="/" replace />;
  }

  if (!address) return null; // render nothing while redirecting
  if (loading && !data) {
    return (
      <DashboardLayout>
        <DashboardSkeleton />
      </DashboardLayout>
    );
  }

  const kpiData: NetworkStats = data || {
    totalAgents: 0,
    totalTasks: 0,
    totalXLMTransacted: 0,
    uptimePercent: 0,
  };

  return (
    <DashboardLayout className="fade-in">
      <section className={styles.statsSection}>
        <NetworkStatsWidget />
      </section>
      <section className={styles.health}>
        <NetworkHealthBadge uptimePercent={kpiData.uptimePercent} />
      </section>
      {(agentsLoading || agents.length > 0) && (
        <section className={styles.recentTasks} aria-labelledby="dashboard-agent-performance">
          <h2 id="dashboard-agent-performance" className={styles.heading}>
            {t("page.dashboard.agentPerformance", { defaultValue: "Agent performance" })}
          </h2>
          {agentsLoading ? (
            <SkeletonTable rows={3} columns={2} />
          ) : (
            <ul className={styles.agentPerformance}>
              {[...agents].sort((a, b) => b.reputation - a.reputation).slice(0, 3).map((agent) => (
                <li key={agent.id}>
                  <span>{agent.name}</span>
                  <strong>{new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(agent.reputation)} / 5</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className={styles.recentTasks}>
        <h2 className={styles.heading}>{t("page.dashboard.recentTasks")}</h2>
        <RecentTasksTable walletAddress={address ?? ""} loading={loading} />
      </section>
    </DashboardLayout>
  );
};

export default DashboardPage;
