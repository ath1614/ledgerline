import { Link } from 'react-router-dom';
import { usePageMotion } from '../lib/motion';

export function NotFound() {
  const pageRef = usePageMotion();

  return (
    <div className="page page--inner" ref={pageRef}>
      <section className="notfound">
        <p className="stamp" aria-hidden="true">
          No entry
        </p>
        <p className="kicker">Folio 404</p>
        <h1 className="display display--inner">This page does not post.</h1>
        <p className="page-head__lede">
          There is no ledger entry at this address, so nothing debits and nothing credits. The trial balance is
          unaffected.
        </p>
        <Link className="button button--primary" to="/">
          Return to the ledger
          <span className="button__arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </section>
    </div>
  );
}
