import { getStorage } from 'firebase-admin/storage';
import { ReleaseStorage } from './service';

function notFound(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 404;
}
// Read-only runtime adapter. The bucket is provisioned separately with uniform
// IAM and enforced public access prevention; no Firebase download tokens/ACLs.
export function releaseStorage(bucketName: () => string): ReleaseStorage {
  const bucket = () => {
    const name = bucketName();
    if (!name || !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(name)) throw new Error('releases_not_configured');
    return getStorage().bucket(name);
  };
  return {
    async read(path, generation) {
      try {
        const file = bucket().file(path, generation ? { generation } : undefined);
        const [metadata] = await file.getMetadata();
        if (Number(metadata.size) > 65536) throw new Error('manifest_too_large');
        const pinned = bucket().file(path, { generation: String(metadata.generation) });
        const [bytes] = await pinned.download({ validation: 'crc32c' });
        if (bytes.length > 65536) throw new Error('manifest_too_large');
        return { bytes, generation: String(metadata.generation), sha256: metadata.metadata?.sha256 as string | undefined };
      } catch (error) { if (notFound(error)) return null; throw error; }
    },
    async metadata(path, generation) {
      try {
        const [m] = await bucket().file(path, { generation }).getMetadata();
        return { size: Number(m.size), generation: String(m.generation), sha256: m.metadata?.sha256 as string | undefined };
      } catch (error) { if (notFound(error)) return null; throw error; }
    },
    async sign(path, generation, fileName, expiresAt) {
      const [url] = await bucket().file(path, { generation }).getSignedUrl({
        version: 'v4', action: 'read', expires: expiresAt,
        queryParams: { generation }, responseDisposition: `attachment; filename="${fileName}"`,
      });
      return url;
    },
  };
}
