// 담당 에이전트가 구현 예정인 계약 스텁
export default function IconSearchDialog({ open }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <div className="modal-backdrop">아직 구현되지 않았습니다</div>;
}
