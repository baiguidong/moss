import { OfficeDocumentViewer, type OfficeViewerProps } from './OfficeDocumentViewer';
export function PPTViewer(props: OfficeViewerProps) { return <OfficeDocumentViewer {...props} kind="ppt" />; }
