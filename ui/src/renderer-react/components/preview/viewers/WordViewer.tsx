import { OfficeDocumentViewer, type OfficeViewerProps } from './OfficeDocumentViewer';
export function WordViewer(props: OfficeViewerProps) { return <OfficeDocumentViewer {...props} kind="word" />; }
