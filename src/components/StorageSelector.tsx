import React, { useEffect, useState, useMemo } from "react";
import { systemApi, type DiskInfo, type FolderInfo } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HardDrive, FolderOpen, ChevronRight, Folder } from "lucide-react";

interface StorageSelectorProps {
  maxStorageGb: number;
  customStorageDir: string;
  onChange: (updates: { maxStorageGb?: number; customStorageDir?: string }) => void;
}

export function StorageSelector({ maxStorageGb, customStorageDir, onChange }: StorageSelectorProps) {
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isFolderBrowserOpen, setIsFolderBrowserOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState(customStorageDir || "/");
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);

  useEffect(() => {
    systemApi.getDisks().then(data => {
      setDisks(data);
    }).catch(err => {
      console.error("Failed to load disks", err);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  const loadFolders = async (path: string) => {
    setFoldersLoading(true);
    try {
      const data = await systemApi.getFolders(path);
      setFolders(data);
      setCurrentPath(path);
    } catch (err) {
      console.error("Failed to load folders", err);
    } finally {
      setFoldersLoading(false);
    }
  };

  useEffect(() => {
    if (isFolderBrowserOpen) {
      loadFolders(currentPath || "/");
    }
  }, [isFolderBrowserOpen, currentPath]);

  // Find which disk the current path belongs to
  const activeDisk = useMemo(() => {
    if (!disks.length) return null;
    let bestMatch: DiskInfo | null = null;
    let maxMatchLen = -1;
    
    for (const disk of disks) {
      if ((customStorageDir || "/").startsWith(disk.mountPoint)) {
        if (disk.mountPoint.length > maxMatchLen) {
          maxMatchLen = disk.mountPoint.length;
          bestMatch = disk;
        }
      }
    }
    return bestMatch || disks.find(d => d.mountPoint === "/") || disks[0];
  }, [disks, customStorageDir]);

  // Parse total size in GB
  const activeDiskTotalGb = useMemo(() => {
    if (!activeDisk) return 0;
    const sizeStr = activeDisk.size.toUpperCase();
    const val = parseFloat(sizeStr);
    if (sizeStr.includes("T")) return val * 1024;
    if (sizeStr.includes("G")) return val;
    if (sizeStr.includes("M")) return val / 1024;
    return val; // fallback
  }, [activeDisk]);

  // Calculate percentage
  const currentPercentage = activeDiskTotalGb > 0 
    ? Math.min(100, Math.max(1, Math.round((maxStorageGb / activeDiskTotalGb) * 100))) 
    : 10;

  const handlePercentageChange = (vals: number[]) => {
    const pct = vals[0];
    if (activeDiskTotalGb > 0) {
      const gb = Math.max(1, Math.round((activeDiskTotalGb * pct) / 100));
      onChange({ maxStorageGb: gb });
    }
  };

  const handleDiskSelect = (disk: DiskInfo) => {
    onChange({ customStorageDir: disk.mountPoint });
    setCurrentPath(disk.mountPoint);
  };

  if (loading) {
    return <div className="text-sm text-gray-500">Loading storage info...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label>Select Storage Disk</Label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {disks.map(disk => {
            const isSelected = activeDisk?.mountPoint === disk.mountPoint;
            return (
              <Card 
                key={disk.mountPoint}
                className={`p-4 cursor-pointer transition-all ${isSelected ? 'border-primary ring-2 ring-primary/20 dark:bg-primary/5' : 'hover:border-gray-400 dark:hover:border-gray-500 dark:border-gray-800'} dark:bg-gray-900`}
                onClick={() => handleDiskSelect(disk)}
              >
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-lg ${isSelected ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                    <HardDrive className="h-6 w-6" />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex justify-between items-center">
                      <div className="font-semibold text-sm truncate dark:text-gray-200">{disk.mountPoint === '/' ? 'System Disk (Root)' : disk.mountPoint}</div>
                      <div className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${isSelected ? 'bg-primary/20 text-primary' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                        {disk.usePercentage}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 mb-2 flex justify-between">
                      <span>{disk.filesystem}</span>
                      <span>{disk.avail} free of {disk.size}</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${isSelected ? 'bg-primary' : 'bg-gray-400 dark:bg-gray-500'}`}
                        style={{ width: disk.usePercentage }}
                      ></div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {activeDisk && (
        <div className="p-5 border rounded-lg bg-gray-50/50 dark:bg-gray-900/50 space-y-6">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label className="text-sm text-muted-foreground font-semibold uppercase tracking-wider">Storage Path</Label>
              <div className="text-sm border px-3 py-2.5 rounded-md bg-background text-foreground truncate shadow-sm flex items-center h-10" title={customStorageDir || "Default"}>
                {customStorageDir ? (
                  customStorageDir
                ) : (
                  <span className="text-muted-foreground italic flex items-center gap-2">
                    <Folder className="h-4 w-4" />
                    Default (backend/storage/)
                  </span>
                )}
              </div>
            </div>
            <Button variant="outline" onClick={() => setIsFolderBrowserOpen(true)} type="button">
              <FolderOpen className="h-4 w-4 mr-2" />
              Browse
            </Button>
          </div>

          <div className="space-y-4 pt-2">
            <div className="flex justify-between items-center">
              <Label className="text-sm text-muted-foreground font-semibold uppercase tracking-wider">Recording Quota</Label>
              <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold">
                {currentPercentage}% ({maxStorageGb} GB)
              </div>
            </div>
            <Slider 
              min={1} 
              max={95} 
              step={1} 
              value={[currentPercentage]} 
              onValueChange={handlePercentageChange} 
              className="py-2"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Set how much of <span className="font-semibold">{activeDisk.mountPoint}</span> ({activeDiskTotalGb.toFixed(0)}GB total) can be used for CCTV recordings before old videos are overwritten.
            </p>
          </div>
        </div>
      )}

      <Dialog open={isFolderBrowserOpen} onOpenChange={setIsFolderBrowserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Browse Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm border dark:border-gray-700 px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-800/50 truncate flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <HardDrive className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              {currentPath}
            </div>
            
            <div className="border dark:border-gray-700 rounded-md h-[300px] overflow-y-auto bg-white dark:bg-[#151515]">
              {foldersLoading ? (
                <div className="p-4 text-sm text-gray-500 dark:text-gray-400 text-center">Loading...</div>
              ) : (
                <ul className="py-2">
                  {folders.map((f, i) => (
                    <li key={i}>
                      <button 
                        type="button"
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm text-left text-gray-700 dark:text-gray-300 transition-colors"
                        onClick={() => loadFolders(f.path)}
                      >
                        <Folder className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                        <span className="flex-1 truncate">{f.name}</span>
                        <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                      </button>
                    </li>
                  ))}
                  {folders.length === 0 && (
                    <li className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">No subfolders</li>
                  )}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsFolderBrowserOpen(false)} type="button">Cancel</Button>
              <Button onClick={() => {
                onChange({ customStorageDir: currentPath });
                setIsFolderBrowserOpen(false);
              }} type="button">Select Folder</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
