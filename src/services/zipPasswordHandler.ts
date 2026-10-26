// Esqueleto: integración completa de password para archives cifrados
// Archivo: src/services/zipPasswordHandler.ts (nuevo)

/**
 * Cuando fsEngine.openZipArchive lanza ArchivePasswordError,
 * hay que:
 * 1. Capturar el error en usePanels (línea ~486)
 * 2. Abrir ZipPasswordModal (ya existe)
 * 3. Pasar la contraseña a openZipArchive de nuevo
 * 4. Si es válida, navegar al archive; si no, mostrar invalid y repetir
 */

export interface PasswordFlow {
  fileItem: import('../types').FileItem;
  attemptCount: number;
  lastError?: 'required' | 'invalid';
}

// Ejemplo de integración en handleOpenItem de usePanels:
// try {
//   handleNavigate(activePanel, await fsEngine.openZipArchive(item, password));
// } catch (e) {
//   if (e instanceof ArchivePasswordError) {
//     const pwd = await showPasswordModal(item.name, e.reason === 'invalid');
//     if (pwd) { /* reintentar con pwd */ }
//   }
// }
