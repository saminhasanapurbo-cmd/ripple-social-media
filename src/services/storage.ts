import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { app } from '../firebase';

const storage = getStorage(app);

export async function uploadMessageImage(conversationId: string, uploaderUid: string, file: File): Promise<{ url: string, path: string }> {
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
  const path = `conversations/${conversationId}/${uploaderUid}/${fileName}`;
  const storageRef = ref(storage, path);
  
  await uploadBytes(storageRef, file);
  
  // TODO: Privacy limitation with getDownloadURL. 
  // Currently, image messages store a Firebase getDownloadURL URL.
  // This does not provide cryptographic participant-only media once the URL is shared externally.
  // In a production environment, consider storing only the Storage paths and using 
  // authenticated media retrieval / trusted backend logic for stronger private-media controls.
  const url = await getDownloadURL(storageRef);
  return { url, path };
}

export async function uploadViewOnceImage(conversationId: string, uploaderUid: string, file: File): Promise<{ path: string }> {
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
  const path = `view_once_uploads/${conversationId}/${uploaderUid}/${fileName}`;
  const storageRef = ref(storage, path);
  
  await uploadBytes(storageRef, file);
  
  // We do NOT return a public download URL. The backend will process this.
  return { path };
}


export async function deleteMessageImage(path: string): Promise<void> {
  const storageRef = ref(storage, path);
  try {
    await deleteObject(storageRef);
  } catch (err) {
    console.error("Failed to clean up image:", err);
  }
}
