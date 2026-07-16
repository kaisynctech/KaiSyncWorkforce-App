'use client'

import { useParams } from 'next/navigation'
import PATaskEditor from '../_editor'

export default function EditPATaskPage() {
  const { id } = useParams()
  return <PATaskEditor mode="edit" taskId={id as string} />
}
