import { Icon, cx } from './ui.jsx'

// A sortable column header: a real button inside the th, aria-sort on the th.
export default function SortHead({ id, label, sort, onSort }) {
  const on = sort.key === id
  return (
    <th scope="col" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={cx('th-sort')} data-sortkey={id} onClick={() => onSort(id)}>
        {label}
        <Icon name={on ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} />
      </button>
    </th>
  )
}
