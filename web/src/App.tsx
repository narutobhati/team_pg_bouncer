import { AnimatePresence, motion } from "framer-motion";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useLiveEvents } from "@/api/hooks";
import { Header } from "@/layout/Header";
import { SummaryBar } from "@/layout/SummaryBar";
import { Tabs } from "@/layout/Tabs";
import { page } from "@/theme/motion";
import { AuditPage } from "@/features/audit/AuditPage";
import { CallDrawer } from "@/features/audit/CallDrawer";
import { IssuesPage } from "@/features/issues/IssuesPage";
import { FixPage } from "@/features/fix/FixPage";
import { TestPage } from "@/features/test/TestPage";
import { HistoryPage } from "@/features/history/HistoryPage";
import { UploadModal } from "@/features/upload/UploadModal";
import { ConnectionBanner } from "@/layout/ConnectionBanner";

export default function App() {
  useLiveEvents();
  const loc = useLocation();
  const section = loc.pathname.split("/")[1] || "audit";

  return (
    <div className="relative min-h-screen">
      <div className="aurora" aria-hidden />
      <div className="grain" aria-hidden />
      <div className="relative z-10">
        <Header />
        <ConnectionBanner />
        <main className="mx-auto max-w-[1440px] px-4 pb-24 pt-5 sm:px-6">
          <SummaryBar />
          <div className="mt-6">
            <Tabs />
          </div>
          <div className="mt-6">
            <AnimatePresence mode="wait">
              <motion.div key={section} variants={page} initial="hidden" animate="show" exit="exit">
                <Routes location={loc}>
                  <Route path="/" element={<Navigate to="/audit" replace />} />
                  <Route path="/audit" element={<AuditPage />} />
                  <Route path="/issues" element={<IssuesPage />} />
                  <Route path="/fix" element={<FixPage />} />
                  <Route path="/test" element={<TestPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="*" element={<Navigate to="/audit" replace />} />
                </Routes>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <CallDrawer />
      <UploadModal />
    </div>
  );
}
