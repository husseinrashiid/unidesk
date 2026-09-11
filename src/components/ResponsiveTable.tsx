import { useLayoutEffect, useRef, type TableHTMLAttributes } from 'react';

/** Preserve one semantic table and expose its column labels in the stacked layout. */
export function ResponsiveTable({children,className='',...props}:TableHTMLAttributes<HTMLTableElement>) {
  const ref=useRef<HTMLTableElement>(null);
  useLayoutEffect(()=>{
    const table=ref.current;if(!table) return;
    const labels=Array.from(table.tHead?.rows[0]?.cells??[]).map(cell=>cell.textContent?.trim()||'Actions');
    for(const body of Array.from(table.tBodies)) for(const row of Array.from(body.rows)) {
      let column=0;
      for(const cell of Array.from(row.cells)) {cell.dataset.label=labels[column]??'';column+=cell.colSpan;}
    }
  },[children]);
  return <table {...props} ref={ref} role="table" className={`responsive-table ${className}`}>{children}</table>;
}
