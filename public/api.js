/**
 * HTTP client wrapper with timeout, offline detection, and stale-request cancellation.
 */

export function setConnectionStatus(statusEl, online) {
  statusEl.className = `status-pill ${online ? 'status-online' : 'status-offline'}`;
  statusEl.querySelector('.status-text').textContent = online ? 'API Connected' : 'API Unreachable';
}

export async function apiFetch(url, options = {}, onStatusChange = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort('superseded');
    } else {
      options.signal.addEventListener('abort', () => controller.abort('superseded'), { once: true });
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      onStatusChange?.(false);
      const offlineErr = new Error('You appear to be offline. Please check your network connection and try again.');
      offlineErr.isNetworkError = true;
      throw offlineErr;
    }

    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || `Server error (${response.status}). Please try again.`);
      err.status = response.status;
      err.details = data.details || [];
      throw err;
    }
    onStatusChange?.(true);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (controller.signal.reason === 'superseded') {
        const cancelledErr = new Error('Request superseded');
        cancelledErr.isSuperseded = true;
        throw cancelledErr;
      }
      onStatusChange?.(false);
      const timeoutErr = new Error('Request timed out. Please check your connection and try again.');
      timeoutErr.isNetworkError = true;
      throw timeoutErr;
    }
    if (err instanceof TypeError) {
      onStatusChange?.(false);
      const netErr = new Error('Unable to reach the HealthTrack server. Verify the server is running.');
      netErr.isNetworkError = true;
      throw netErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
