import React from 'react';
import FolderIcon from './icons/FolderIcon';

export const GroupDivider = ({ label, folderPath }) => {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider whitespace-nowrap select-none">
      {folderPath ? (
        <>
          <FolderIcon className="w-3 h-3 text-neutral-500 flex-shrink-0" />
          <span className="truncate max-w-[200px]">{folderPath}</span>
        </>
      ) : null}
      {folderPath && label ? (
        <span className="text-neutral-600 mx-0.5">|</span>
      ) : null}
      {label ? (
        <span>{label}</span>
      ) : null}
    </div>
  );
};

export default GroupDivider;
