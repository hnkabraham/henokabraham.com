"""Offline regression checks for CSV parsing, reconciliation and privacy."""
import csv
import datetime as dt
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('flighty_import', Path(__file__).with_name('import-flighty.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FlightyImportTests(unittest.TestCase):
    def setUp(self):
        self.airports = {c: dict(code=c, name=c, country='US', latitude=0, longitude=i * 10) for i, c in enumerate(['AAA', 'BBB', 'CCC'])}
        self.before = dt.date(2026, 9, 13)

    def row(self, **updates):
        row = {'Date':'2025-01-02', 'Airline':'UAL', 'Flight':'123', 'From':'AAA', 'To':'BBB', 'Canceled':'false', 'Diverted To':'', 'Aircraft Type Name':'Boeing 787, test', 'Gate Departure (Scheduled)':'2025-01-02T12:34', 'Landing (Actual)':'2025-01-02T14:56', 'PNR':'PRIVATE_BOOKING', 'Seat':'PRIVATE_SEAT', 'Notes':'PRIVATE_NOTE', 'Flight Flighty ID':'PRIVATE_ID'}
        row.update(updates)
        return row

    def run_rows(self, rows):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'private.csv'
            with file.open('w', newline='', encoding='utf-8-sig') as stream:
                writer=csv.DictWriter(stream, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
            return module.read_flights(file, self.airports, self.before)

    def test_reconcile_deduplicate_and_exclude(self):
        source = self.row()
        flights, audit = self.run_rows([source, source, self.row(Canceled='true'), self.row(Date='2026-09-13'), self.row(Date='2027-01-01'), self.row(Date='2025-01-03')])
        self.assertEqual(len(flights), 2)
        self.assertEqual((audit['canceled'],audit['cutoffExcluded'],audit['duplicates']), (1,2,1))
        self.assertEqual(flights[0]['date'], '2025-01-03')
        self.assertNotEqual(flights[0]['id'], flights[1]['id'])
        self.assertEqual(flights[0]['aircraft'], 'Boeing 787, test')
        output=module.render(flights,self.airports,audit)
        for private in ['PRIVATE_BOOKING','PRIVATE_SEAT','PRIVATE_NOTE','PRIVATE_ID','12:34','14:56']:
            self.assertNotIn(private,output)

    def test_diversion_and_return_to_origin(self):
        flights, audit = self.run_rows([self.row(**{'Diverted To':'CCC'}),self.row(Date='2025-01-03', **{'Diverted To':'AAA'})])
        self.assertEqual(audit['diversions'],2)
        self.assertEqual((flights[0]['from_'],flights[0]['to'],flights[0]['scheduledTo']),('AAA','AAA','BBB'))
        self.assertEqual((flights[1]['to'],flights[1]['scheduledTo']),('CCC','BBB'))

    def test_missing_times_do_not_invent_or_drop_historical_trip(self):
        flights,audit=self.run_rows([self.row(**{'Landing (Actual)':''})])
        self.assertEqual(len(flights),1)
        self.assertEqual(audit['timingUnavailable'],1)
        self.assertNotIn('Landing (Actual)',flights[0])

    def test_unknown_values_fail_explicitly(self):
        for changes in [{'Canceled':'maybe'}, {'From':'ZZZ'}, {'Airline':'ZZZ'}, {'Date':'not-a-date'}]:
            with self.assertRaises(ValueError):
                self.run_rows([self.row(**changes)])


if __name__=='__main__':
    unittest.main()
