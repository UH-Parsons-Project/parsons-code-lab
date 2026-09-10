export function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString();
}

export function formatDateTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString();
}

export function formatDateTimeWithoutSeconds(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString([], {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function showError(message) {
    const errorEl = document.getElementById('error-message');
    if (errorEl) {
        const escapedMessage = escapeHtml(message);
        const formattedMessage = escapedMessage === escapeHtml('Incorrect username, email, or password')
            ? 'Incorrect username,<br>email, or password'
            : escapedMessage;

        errorEl.innerHTML = formattedMessage;
        errorEl.style.display = 'block';
    } else {
        alert(message);
    }
}

export function getRoleBadgeClass(role) {
    if (!role) return 'badge-light text-muted';
    switch (role.toLowerCase()) {
        case 'admin':
            return 'badge-warning';
        case 'teacher':
            return 'badge-info';
        case 'student':
            return 'badge-success';
        default:
            return 'badge-light text-muted';
    }
}

export function makeKeyActivatable(el, handler) {
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handler(e);
        }
    });
}

export function formatTime(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    if (!Number.isFinite(seconds)) return '—';
    if (seconds < 0) return '—';
    if (seconds === 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function showAlert(container, message, type = 'danger') {
    if (!container) return;
    container.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show" role="alert" style="border-radius: 8px;">
        ${escapeHtml(message)}
        <button type="button" class="close" data-dismiss="alert" aria-label="Close">
            <span aria-hidden="true">&times;</span>
        </button>
    </div>
    `;
}
