import { Camera } from 'lucide-react'

// The fallback when the live camera cannot be used: a dashed viewfinder over a file input with the camera hint.
export default function FilePicker({ task, inputKey, inputRef, onChange }) {
  return (
    <label className="cap-picker" data-testid="file-picker">
      <input key={inputKey} ref={inputRef} type="file" accept="image/*" capture={task.camera} onChange={onChange} aria-label="Take or choose a photo" />
      <span className="cap-picker__target">
        <span className="cap-picker__reticle"><Camera size={30} className="cap-icon" aria-hidden="true" /></span>
        <span>
          <span className="cap-picker__title">Tap to capture</span>
          <span className="cap-picker__cap" style={{ display: 'block' }}>{task.camera === 'user' ? 'Front camera' : 'Rear camera'} · photo quality check</span>
        </span>
      </span>
    </label>
  )
}
