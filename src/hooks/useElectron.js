const el = typeof window !== 'undefined' && window.electron

export const isElectron = !!el?.isElectron

export const pickFolder = (title) => el ? el.openFolder({ title }) : Promise.resolve(null)
export const pickFile   = (title, filters) => el ? el.openFile({ title, filters }) : Promise.resolve(null)
export const saveFilePath = (title, defaultPath, filters) => el ? el.saveFile({ title, defaultPath, filters }) : Promise.resolve(null)
export const writeToDisk  = (path, content) => el ? el.writeFile(path, content) : Promise.resolve({ ok: false })
