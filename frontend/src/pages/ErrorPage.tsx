/**
 * ErrorPage — React Router error element for route-level 404s and loader errors.
 *
 * Used as `errorElement` on route definitions.  Renders a human-friendly
 * message, the HTTP error code, and navigation back to the dashboard.
 *
 * Issue #657: adds this component as the router errorElement so React Router
 * loader and action errors (including 404s) are presented gracefully rather
 * than crashing the app.
 */

import React from 'react';
import { useRouteError, isRouteErrorResponse, Link } from 'react-router-dom';
import styles from './ErrorPage.module.css';

const ErrorPage: React.FC = () => {
  const error = useRouteError();

  let statusCode = 500;
  let title = 'Unexpected Error';
  let message = 'An unexpected error occurred. Please try again or return to the dashboard.';

  if (isRouteErrorResponse(error)) {
    statusCode = error.status;
    switch (error.status) {
      case 404:
        title = 'Page Not Found';
        message = 'The page you are looking for does not exist or has been moved.';
        break;
      case 403:
        title = 'Access Denied';
        message = 'You do not have permission to view this page.';
        break;
      case 401:
        title = 'Authentication Required';
        message = 'Please connect your wallet to access this page.';
        break;
      default:
        title = `Error ${error.status}`;
        message = error.statusText || message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>{title}</h1>
      <p className={styles.body}>{message}</p>
      {statusCode !== 500 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Error code: <strong>{statusCode}</strong>
        </p>
      )}
      <div className={styles.actions}>
        <Link to="/" className={styles.primaryButton}>
          Return to Dashboard
        </Link>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => window.history.back()}
        >
          Go Back
        </button>
      </div>
    </div>
  );
};

export default ErrorPage;
