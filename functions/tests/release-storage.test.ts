import { expect, it, vi } from 'vitest';
import { releaseStorage } from '../src/releases/storage';

const getSignedUrl = vi.hoisted(() => vi.fn(async () => ['https://storage.googleapis.com/test?signed']));
const file = vi.hoisted(() => vi.fn(() => ({ getSignedUrl })));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({ file }) }) }));

it('uses V4 read-only signing, exact object generation and attachment disposition', async () => {
  const storage = releaseStorage(() => 'private-bucket');
  const expiry = Date.now() + 300000;
  await storage.sign('releases/novaStar/1.0.27/windows/hash/installer.exe', '123', 'installer.exe', expiry);
  expect(file).toHaveBeenCalledWith('releases/novaStar/1.0.27/windows/hash/installer.exe', { generation: '123' });
  expect(getSignedUrl).toHaveBeenCalledWith({ version: 'v4', action: 'read', expires: expiry,
    queryParams: { generation: '123' }, responseDisposition: 'attachment; filename="installer.exe"' });
});
it('an unconfigured bucket fails closed without choosing default Firebase Storage', async () => {
  await expect(releaseStorage(() => '').sign('x', '1', 'a.exe', Date.now())).rejects.toThrow();
});
