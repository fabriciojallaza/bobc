const API_BASE = 'https://bobc.condordev.xyz';

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  return res.json();
}

export const api = {
  // KYC
  submitKyc: (data: { wallet: string; nombre: string; ci: string; telefono: string }) =>
    request('/kyc', { method: 'POST', body: JSON.stringify(data) }),

  getKycStatus: (wallet: string) =>
    request(`/kyc/${wallet}`),

  // Orders
  createOrder: (data: { wallet: string; amount_bs: number }) =>
    request('/orders', { method: 'POST', body: JSON.stringify(data) }),

  getOrders: (wallet: string) =>
    request(`/orders/${wallet}`),

  uploadReceipt: (orderId: number, image_base64: string) =>
    request(`/orders/${orderId}/receipt`, {
      method: 'POST',
      body: JSON.stringify({ image_base64 }),
    }),

  // Health / transparency
  getHealth: () =>
    request('/health'),

  getTransparency: () =>
    request('/transparency'),

  getActivity: () =>
    request('/agent/activity'),

  getProfile: (wallet: string) =>
    request(`/profile/${wallet}`),

  // Admin
  getAdminOrders: () =>
    request('/admin/orders'),

  getAdminKyc: () =>
    request('/admin/kyc'),
};
