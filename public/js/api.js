const API = {
  async request(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      credentials: 'same-origin',
      ...options,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/auth/')) {
        window.location.href = '/';
      }
      throw new Error(data.error || `Error ${res.status}`);
    }

    return data;
  },

  login(username, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  logout() {
    return this.request('/auth/logout', { method: 'POST' });
  },

  me() {
    return this.request('/auth/me');
  },

  getProjects() {
    return this.request('/projects');
  },

  getProject(id) {
    return this.request(`/projects/${id}`);
  },

  createProject(data) {
    return this.request('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateProject(id, data) {
    return this.request(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteProject(id) {
    return this.request(`/projects/${id}`, { method: 'DELETE' });
  },

  getSchemas(projectId) {
    return this.request(`/properties/${projectId}/schemas`);
  },

  async importPropertiesFile(projectId, hsObjectType, file) {
    const form = new FormData();
    form.append('hsObjectType', hsObjectType);
    form.append('file', file);

    const res = await fetch(`/api/properties/${projectId}/import`, {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) window.location.href = '/';
      throw new Error(data.error || `Error ${res.status}`);
    }
    return data;
  },

  createProperties(projectId, hsObjectType, names) {
    return this.request(`/properties/${projectId}/create`, {
      method: 'POST',
      body: JSON.stringify({ hsObjectType, names }),
    });
  },

  testConnection(projectId) {
    return this.request(`/merge/${projectId}/test-connection`, {
      method: 'POST',
    });
  },

  simulate(projectId, filters = {}) {
    return this.request(`/merge/${projectId}/simulate`, {
      method: 'POST',
      body: JSON.stringify(filters),
    });
  },

  applyMerge(projectId, filters = {}) {
    return this.request(`/merge/${projectId}/apply`, {
      method: 'POST',
      body: JSON.stringify(filters),
    });
  },

  getFailedMerges(projectId) {
    return this.request(`/merge/${projectId}/failed-merges`);
  },

  retryFailedWithStream(projectId, options = {}, handlers = {}) {
    return this.mergeWithStream(projectId, 'retry-failed', { ...options, retryFailed: true }, handlers);
  },

  getActiveMergeJob(projectId) {
    return this.request(`/merge/${projectId}/active-job`);
  },

  /**
   * Reconecta al progreso de un proceso en curso o reciente (SSE).
   */
  subscribeActiveMergeStream(projectId, handlers = {}, since = 0) {
    const qs = since > 0 ? `?since=${since}` : '';
    return this.consumeSseResponse(
      fetch(`/api/merge/${projectId}/active-job/stream${qs}`, { credentials: 'same-origin' }),
      handlers,
    );
  },

  /**
   * @param {Promise<Response>} responsePromise
   * @param {{ onProgress?: Function, onLog?: Function }} handlers
   */
  async consumeSseResponse(responsePromise, handlers = {}) {
    const res = await responsePromise;

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) window.location.href = '/';
      throw new Error(data.error || `Error ${res.status}`);
    }

    return this.readSseBody(res, handlers);
  },

  /**
   * Ejecuta simulación, fusión o reintento con progreso en tiempo real (SSE).
   * @param {string} projectId
   * @param {'simulate' | 'apply' | 'retry-failed'} action
   * @param {object} filters
   * @param {{ onProgress?: Function, onLog?: Function }} handlers
   */
  async mergeWithStream(projectId, action, filters = {}, handlers = {}) {
    return this.consumeSseResponse(
      fetch(`/api/merge/${projectId}/${action}?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ...filters, stream: true }),
      }),
      handlers,
    );
  },

  readSseBody(res, handlers = {}) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let settled = false;

    return new Promise((resolve, reject) => {
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      const processEvent = (block) => {
        const lines = block.split('\n');
        let eventName = 'message';
        let dataLine = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventName = line.slice(7).trim();
          else if (line.startsWith('data: ')) dataLine = line.slice(6);
        }
        if (!dataLine) return;
        let data;
        try {
          data = JSON.parse(dataLine);
        } catch {
          return;
        }
        if (eventName === 'progress') handlers.onProgress?.(data);
        else if (eventName === 'log') handlers.onLog?.(data);
        else if (eventName === 'complete') finish(resolve, data);
        else if (eventName === 'error') finish(reject, new Error(data.message || 'Error'));
      };

      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
              if (part.trim()) processEvent(part);
            }
          }
          if (buffer.trim()) processEvent(buffer);
          finish(reject, new Error('Conexión cerrada sin resultado'));
        } catch (err) {
          finish(reject, err);
        }
      })();
    });
  },

  getRuns(projectId) {
    return this.request(`/merge/${projectId}/runs`);
  },

  getRun(projectId, runId) {
    return this.request(`/merge/${projectId}/runs/${runId}`);
  },

  getLogs(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/logs${qs ? '?' + qs : ''}`);
  },

  getUsers() {
    return this.request('/admin/users');
  },

  createUser(data) {
    return this.request('/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateUserPassword(id, password) {
    return this.request(`/admin/users/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
  },

  deleteUser(id) {
    return this.request(`/admin/users/${id}`, { method: 'DELETE' });
  },
};

async function requireAuth() {
  try {
    const { user } = await API.me();
    return user;
  } catch {
    window.location.href = '/';
    return null;
  }
}

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-ES');
}

function statusBadge(status) {
  const map = {
    SUCCESS: 'badge-success',
    ERROR: 'badge-error',
    INFO: 'badge-info',
    WARNING: 'badge-warning',
    planned: 'badge-neutral',
    merged: 'badge-success',
    failed: 'badge-error',
    skipped: 'badge-warning',
  };
  return `<span class="badge ${map[status] || 'badge-neutral'}">${status}</span>`;
}

function entityLabel(type) {
  return type === 'contacts' ? 'Contactos' : 'Empresas';
}

async function logout() {
  await API.logout();
  window.location.href = '/';
}
