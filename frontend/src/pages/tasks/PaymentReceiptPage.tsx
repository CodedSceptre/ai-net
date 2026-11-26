import { useParams } from "react-router-dom";
import { SkeletonText } from "../../components/common/Skeleton";
import PaymentReceiptCard from "../../components/wallet/PaymentReceiptCard";
import { useWallet } from "../../context/WalletContext";
import {
  formatPaymentTimestamp,
  useTaskPayments,
} from "../../hooks/useTaskPayments";
import { useToast } from "../../hooks/useToast";
import styles from "./PaymentReceiptPage.module.css";

export default function PaymentReceiptPage() {
  const { id } = useParams();
  const { publicKey } = useWallet();
  const { showToast } = useToast();
  const { receipt, payments, totalXLM, isLoading, error } = useTaskPayments(
    id,
    publicKey,
  );

  async function shareReceipt() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Receipt link copied", "success");
    } catch {
      showToast("Could not copy the receipt link", "error");
    }
  }

  return (
    <section className={`glass-panel ${styles.receipt}`}>
      <h1 className="text-2xl font-bold">Payment receipt</h1>
      {isLoading && (
        <div aria-busy="true" aria-label="Loading payments">
          <SkeletonText lines={4} />
        </div>
      )}
      {error && <p role="alert">Unable to load this payment receipt.</p>}
      {!publicKey && <p>Connect your wallet to view the receipt.</p>}
      {receipt && (
        <>
          <p className="break-all">Task {receipt.taskId}</p>
          {receipt.completionTimestamp && (
            <p>
              Completed{" "}
              <time dateTime={receipt.completionTimestamp}>
                {formatPaymentTimestamp(receipt.completionTimestamp)}
              </time>
            </p>
          )}
          <p className="break-words">{receipt.prompt}</p>
          <div className="receipt-action flex flex-wrap gap-4 py-4">
            <button
              type="button"
              className="underline"
              onClick={() => window.print()}
            >
              Download PDF
            </button>
            <button
              type="button"
              className="underline"
              onClick={() => void shareReceipt()}
            >
              Share Receipt
            </button>
          </div>
          {payments.length === 0 ? (
            <p>No payments have been recorded for this task yet.</p>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Agent name</th>
                    <th scope="col">Capability</th>
                    <th scope="col">Amount (XLM)</th>
                    <th scope="col">Tx hash</th>
                    <th scope="col">Status</th>
                    <th scope="col">Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <PaymentReceiptCard
                      key={payment.nodeId}
                      payment={payment}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 font-semibold">
            Total spent{" "}
            {totalXLM.toLocaleString(undefined, { maximumFractionDigits: 7 })}{" "}
            XLM
          </p>
        </>
      )}
    </section>
  );
}
