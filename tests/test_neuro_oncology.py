"""The knowledge a clinical record is read against.

What is being defended here is not that the rules exist but that they stay
honest in three specific ways, because each of the three has an obvious wrong
answer that would look right on screen.

The first is that a molecular result can outrank the grade somebody typed, and
that it says so out loud. Homozygous CDKN2A/B deletion makes an IDH-mutant
astrocytoma a CNS WHO grade 4 whatever the microscope showed. The record has to
go on saying what the pathologist wrote while the reading beside it says what
the classification makes of it — silently rewriting the grade would leave
nobody able to tell which of the two they were looking at.

The second is that a contradiction is reported as a contradiction. An entity
named "IDH tự nhiên" beside a sequencing result of "Đột biến" is not an
unusual tumour, it is a typing error in one of the two fields, and a reader
must not be handed a diagnosis line that asserts both.

The third is that nothing is invented. An entity this file has no rule for gets
no protocol and no work-up list, and a test nobody ran is reported as not run
rather than as normal.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import clinical_record
import neuro_oncology


def _tumor(**parts) -> dict:
    """A tumour as the form would post it, with histology confirmed by default.

    `basis` defaults to the histological one because most of what is tested
    here is the molecular reading, and an imaging-only tumour can never be
    integrated no matter what its markers say — that rule gets its own test
    rather than quietly suppressing every other one.
    """
    tumor = {"basis": "Mô bệnh học", "molecular": {}}
    tumor.update(parts)
    return tumor


ASTRO = "U sao bào, IDH đột biến"
OLIGO = "U thần kinh đệm ít nhánh, IDH đột biến, đồng mất 1p/19q"
GBM = "U nguyên bào thần kinh đệm, IDH tự nhiên"


class MarkerVocabularyTests(unittest.TestCase):
    def test_every_marker_offers_the_not_done_answer_or_takes_a_measurement(self):
        """A test that was declined has somewhere to be recorded.

        Leaving the field blank would make "nobody has run it" and "we decided
        not to" the same state, and a work-up list cannot tell the reader which
        question is still open if it cannot tell those apart. Markers that
        carry a measurement rather than a verdict — Ki-67, the mitotic count —
        have no fixed list at all and are exempt.
        """
        for name, spec in neuro_oncology.MARKERS.items():
            results = spec.get("results", ())
            if not results:
                self.assertIn(
                    name,
                    ("Ki-67", "Hồ sơ methyl hoá", "Chỉ số nhân chia"),
                    f"{name} has no results and is not a free-text measurement",
                )
                continue
            self.assertIn(neuro_oncology.NOT_DONE, results, name)

    def test_idh_separates_a_negative_antibody_from_a_negative_sequence(self):
        """The one distinction that turns a grade 2 tumour into a grade 4 one.

        Immunohistochemistry sees IDH1 R132H and nothing else, so a negative
        stain leaves the non-canonical IDH1 and IDH2 substitutions untested. If
        the vocabulary offered a single "âm tính", an IHC-negative astrocytoma
        would be recorded as IDH-wildtype and read as a glioblastoma.
        """
        results = neuro_oncology.MARKERS["IDH1/2"]["results"]
        self.assertIn("Không đột biến (đã giải trình tự)", results)
        self.assertIn("IHC R132H âm tính (chưa giải trình tự)", results)

    def test_an_antibody_negative_result_does_not_establish_wildtype(self):
        """It must not satisfy the rules that a sequenced negative satisfies."""
        tumor = _tumor(
            histology=ASTRO,
            molecular={"IDH1/2": "IHC R132H âm tính (chưa giải trình tự)"},
        )
        self.assertNotIn("IDH tự nhiên", neuro_oncology.assess(tumor)["line"])

    def test_the_form_offers_exactly_the_answers_the_rules_match_on(self):
        """The served vocabulary and the rule table are one list, not two.

        The rules compare exactly, so a marker whose form offers wording the
        rules do not recognise is a field that can be filled in correctly and
        still drive nothing.
        """
        served = clinical_record.vocabulary()
        self.assertEqual(
            sorted(served["molecularMarkers"]),
            sorted(neuro_oncology.MARKERS),
        )
        for name, spec in neuro_oncology.MARKERS.items():
            self.assertEqual(served["markerResults"][name], list(spec.get("results", ())))


class GradeTests(unittest.TestCase):
    def test_cdkn2a_deletion_makes_an_idh_mutant_astrocytoma_grade_four(self):
        """WHO CNS5 grades this entity on the deletion, not on the histology."""
        tumor = _tumor(
            histology=ASTRO,
            grade="2",
            molecular={"IDH1/2": "Đột biến", "CDKN2A/B": "Mất đồng hợp tử"},
        )
        grade = neuro_oncology.effective_grade(tumor)
        self.assertEqual(grade["grade"], "4")
        self.assertEqual(grade["source"], "molecular")
        self.assertIn("CDKN2A/B", grade["rule"])

    def test_the_recorded_grade_survives_being_outranked(self):
        """Both numbers stay on screen, so nobody has to guess which is which.

        Overwriting the recorded grade would erase what the pathology report
        said. Dropping the derived one would leave a grade 4 tumour on a grade
        2 pathway. The record keeps one and the reading supplies the other.
        """
        tumor = _tumor(
            histology=ASTRO,
            grade="2",
            molecular={"IDH1/2": "Đột biến", "CDKN2A/B": "Mất đồng hợp tử"},
        )
        self.assertEqual(neuro_oncology.effective_grade(tumor)["recorded"], "2")
        self.assertEqual(tumor["grade"], "2")

    def test_an_intact_cdkn2a_leaves_the_recorded_grade_alone(self):
        tumor = _tumor(
            histology=ASTRO,
            grade="2",
            molecular={"IDH1/2": "Đột biến", "CDKN2A/B": "Không mất đồng hợp tử"},
        )
        grade = neuro_oncology.effective_grade(tumor)
        self.assertEqual(grade["grade"], "2")
        self.assertEqual(grade["source"], "recorded")
        self.assertEqual(grade["rule"], "")

    def test_an_untested_cdkn2a_does_not_escalate(self):
        """A test nobody ran is not a negative result and not a positive one."""
        tumor = _tumor(histology=ASTRO, grade="2", molecular={"IDH1/2": "Đột biến"})
        self.assertEqual(neuro_oncology.effective_grade(tumor)["grade"], "2")

    def test_tert_mutation_makes_a_meningioma_grade_three(self):
        tumor = _tumor(
            histology="U màng não", grade="1",
            molecular={"TERT promoter": "Đột biến"},
        )
        grade = neuro_oncology.effective_grade(tumor)
        self.assertEqual(grade["grade"], "3")
        self.assertEqual(grade["source"], "molecular")

    def test_the_astrocytoma_rule_does_not_reach_other_entities(self):
        """A deletion that grades one entity must not grade every entity.

        CDKN2A/B is a grade 4 criterion inside IDH-mutant astrocytoma. Applied
        to an oligodendroglioma — which WHO CNS5 does not grade 4 at all — it
        would produce a grade that does not exist.
        """
        tumor = _tumor(
            histology=OLIGO, grade="3",
            molecular={"IDH1/2": "Đột biến", "CDKN2A/B": "Mất đồng hợp tử"},
        )
        self.assertEqual(neuro_oncology.effective_grade(tumor)["grade"], "3")


class ContradictionTests(unittest.TestCase):
    def test_a_wildtype_entity_beside_a_mutant_result_is_reported(self):
        tumor = _tumor(histology=GBM, grade="4", molecular={"IDH1/2": "Đột biến"})
        conflicts = neuro_oncology.contradictions(tumor)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["marker"], "IDH1/2")

    def test_a_mutant_entity_beside_a_sequenced_wildtype_result_is_reported(self):
        tumor = _tumor(
            histology=ASTRO, grade="3",
            molecular={"IDH1/2": "Không đột biến (đã giải trình tự)"},
        )
        self.assertTrue(neuro_oncology.contradictions(tumor))

    def test_codeletion_in_an_astrocytoma_is_reported_as_a_misfiling(self):
        """The two lines are mutually exclusive in WHO CNS5.

        This is not a rare variant to be recorded and moved past — one of the
        two fields is wrong, and the message says which way the evidence points
        rather than only that something is amiss.
        """
        tumor = _tumor(
            histology=ASTRO, grade="2",
            molecular={"IDH1/2": "Đột biến", "1p/19q": "Đồng mất"},
        )
        conflicts = neuro_oncology.contradictions(tumor)
        self.assertEqual(len(conflicts), 1)
        self.assertIn("ít nhánh", conflicts[0]["text"])

    def test_a_contradicted_marker_stays_out_of_the_diagnosis_line(self):
        """The line must not assert both halves of a disagreement.

        "U nguyên bào thần kinh đệm, IDH tự nhiên — IDH đột biến" reads as one
        finding rather than two that cannot both be true, and a reader skimming
        the card would take it as a diagnosis rather than as an error.
        """
        tumor = _tumor(histology=GBM, grade="4", molecular={"IDH1/2": "Đột biến"})
        self.assertNotIn("— IDH đột biến", neuro_oncology.assess(tumor)["line"])

    def test_agreement_raises_nothing(self):
        tumor = _tumor(
            histology=OLIGO, grade="2",
            molecular={"IDH1/2": "Đột biến", "1p/19q": "Đồng mất"},
        )
        self.assertEqual(neuro_oncology.contradictions(tumor), [])

    def test_free_text_that_merely_resembles_a_result_fires_nothing(self):
        """Rules match the listed answers exactly, and nothing else.

        A typed note is stored and shown, but it cannot be read as a verdict it
        happens to share words with.
        """
        tumor = _tumor(histology=GBM, grade="4", molecular={"IDH1/2": "nghi ngờ đột biến, chờ xác nhận"})
        self.assertEqual(neuro_oncology.contradictions(tumor), [])


class WorkupTests(unittest.TestCase):
    def test_an_astrocytoma_without_cdkn2a_is_not_integrated(self):
        """The test that decides the grade is an essential one.

        Without it the tumour may be a grade 2 or a grade 4, and a diagnosis
        that cannot say which is not a finished diagnosis.
        """
        tumor = _tumor(
            histology=ASTRO, grade="2",
            molecular={"IDH1/2": "Đột biến", "ATRX": "Mất biểu hiện"},
        )
        result = neuro_oncology.assess(tumor)
        self.assertFalse(result["integrated"])
        unmet = [gap["markers"] for gap in result["missing"] if gap["essential"]]
        self.assertIn(["CDKN2A/B"], unmet)

    def test_a_full_essential_panel_is_integrated(self):
        tumor = _tumor(
            histology=ASTRO, grade="2",
            molecular={
                "IDH1/2": "Đột biến",
                "ATRX": "Mất biểu hiện",
                "CDKN2A/B": "Không mất đồng hợp tử",
            },
        )
        self.assertTrue(neuro_oncology.assess(tumor)["integrated"])

    def test_either_atrx_or_codeletion_settles_the_astrocytic_line(self):
        """WHO CNS5 needs codeletion ruled out, and either test rules it out.

        Requiring both would leave a finished work-up permanently one test
        short, on every astrocytoma recorded by a department that stains for
        ATRX and therefore never sends 1p/19q — and on every one recorded by a
        department that does the reverse.
        """
        shared = {"IDH1/2": "Đột biến", "CDKN2A/B": "Không mất đồng hợp tử"}
        by_atrx = _tumor(histology=ASTRO, grade="2",
                         molecular={**shared, "ATRX": "Mất biểu hiện"})
        by_codeletion = _tumor(histology=ASTRO, grade="2",
                               molecular={**shared, "1p/19q": "Không đồng mất"})
        self.assertTrue(neuro_oncology.assess(by_atrx)["integrated"])
        self.assertTrue(neuro_oncology.assess(by_codeletion)["integrated"])

    def test_neither_alternative_leaves_one_requirement_not_two(self):
        """The pair reads as the single question it is.

        Listing ATRX and 1p/19q as two outstanding tests would say the work-up
        is two steps from finished when it is one.
        """
        tumor = _tumor(histology=ASTRO, grade="2",
                       molecular={"IDH1/2": "Đột biến", "CDKN2A/B": "Không mất đồng hợp tử"})
        unmet = [gap for gap in neuro_oncology.assess(tumor)["missing"] if gap["essential"]]
        self.assertEqual([gap["markers"] for gap in unmet], [["ATRX", "1p/19q"]])
        self.assertFalse(unmet[0]["declined"])

    def test_a_pair_counts_as_declined_only_when_both_were(self):
        """One blank alternative means the question is open, not closed."""
        both = _tumor(histology=ASTRO, grade="2", molecular={
            "IDH1/2": "Đột biến", "CDKN2A/B": "Không mất đồng hợp tử",
            "ATRX": neuro_oncology.NOT_DONE, "1p/19q": neuro_oncology.NOT_DONE,
        })
        one = _tumor(histology=ASTRO, grade="2", molecular={
            "IDH1/2": "Đột biến", "CDKN2A/B": "Không mất đồng hợp tử",
            "ATRX": neuro_oncology.NOT_DONE,
        })
        def unmet(tumor):
            gaps = neuro_oncology.assess(tumor)["missing"]
            return [gap for gap in gaps if gap["essential"]][0]

        self.assertTrue(unmet(both)["declined"])
        self.assertFalse(unmet(one)["declined"])

    def test_a_declined_test_is_still_an_open_work_up_item(self):
        """Recording "chưa làm" answers who was asked, not what the tumour is.

        It is reported differently from a blank, so the reader is not sent to
        chase a question somebody has already considered — but the diagnosis is
        no more integrated for the test having been declined.
        """
        tumor = _tumor(
            histology=ASTRO, grade="2",
            molecular={
                "IDH1/2": "Đột biến",
                "ATRX": "Mất biểu hiện",
                "CDKN2A/B": neuro_oncology.NOT_DONE,
            },
        )
        result = neuro_oncology.assess(tumor)
        self.assertFalse(result["integrated"])
        declined = [gap for gap in result["missing"] if gap["markers"] == ["CDKN2A/B"]]
        self.assertTrue(declined[0]["declined"])

    def test_free_text_in_a_marker_does_not_close_the_requirement(self):
        """The field looks filled in and settles nothing.

        The rules match the listed answers exactly, so "chờ kết quả giải trình
        tự" in the IDH field drives no rule at all — yet counting it as an
        answer was enough to report a glioblastoma as an integrated diagnosis
        on the strength of a note saying the sequencing had not come back.
        """
        tumor = _tumor(histology=GBM, grade="4",
                       molecular={"IDH1/2": "chờ kết quả giải trình tự"})
        result = neuro_oncology.assess(tumor)
        self.assertFalse(result["integrated"])
        unmet = [gap for gap in result["missing"] if gap["essential"]]
        self.assertEqual([gap["markers"] for gap in unmet], [["IDH1/2"]])
        # Reported as its own state: the answer is on the record and needs
        # transcribing, which is a different errand from ordering a test.
        self.assertTrue(unmet[0]["unreadable"])
        self.assertFalse(unmet[0]["declined"])

    def test_the_text_that_could_not_be_read_is_still_stored(self):
        """It is what the report said, so it stays on the record and on screen.

        Refusing to read it is not the same as throwing it away.
        """
        tumor = _tumor(histology=GBM, grade="4",
                       molecular={"IDH1/2": "chờ kết quả giải trình tự"})
        self.assertEqual(neuro_oncology.marker(tumor, "IDH1/2"),
                         "chờ kết quả giải trình tự")

    def test_a_marker_that_takes_a_measurement_accepts_any_text(self):
        """Ki-67 and the mitotic count have no list to match against.

        Their answer is a number off the report, so demanding a listed value
        would make every one of them permanently unreadable.
        """
        tumor = _tumor(
            histology=ASTRO, grade="2",
            molecular={
                "IDH1/2": "Đột biến",
                "ATRX": "Mất biểu hiện",
                "CDKN2A/B": "Không mất đồng hợp tử",
                "Ki-67": "25%",
            },
        )
        self.assertTrue(neuro_oncology.assess(tumor)["integrated"])

    def test_the_three_outstanding_states_stay_distinct(self):
        """Blank, declined and unreadable send a reader to three places."""
        def unmet(value):
            molecular = {"IDH1/2": value} if value else {}
            gaps = neuro_oncology.assess(_tumor(histology=GBM, grade="4",
                                                molecular=molecular))["missing"]
            return [gap for gap in gaps if gap["essential"]][0]

        blank = unmet("")
        self.assertFalse(blank["declined"])
        self.assertFalse(blank["unreadable"])

        declined = unmet(neuro_oncology.NOT_DONE)
        self.assertTrue(declined["declined"])
        self.assertFalse(declined["unreadable"])

        unreadable = unmet("kết quả ghi trong bệnh án giấy")
        self.assertFalse(unreadable["declined"])
        self.assertTrue(unreadable["unreadable"])

    def test_imaging_alone_is_never_an_integrated_diagnosis(self):
        """A complete molecular panel on an unbiopsied tumour is still an impression.

        `basis` exists precisely so an imaging diagnosis cannot be read back as
        a result, and the integrated flag has to respect it.
        """
        tumor = _tumor(
            histology=ASTRO, grade="2", basis="Hình ảnh",
            molecular={
                "IDH1/2": "Đột biến",
                "ATRX": "Mất biểu hiện",
                "CDKN2A/B": "Không mất đồng hợp tử",
            },
        )
        self.assertFalse(neuro_oncology.assess(tumor)["integrated"])

    def test_an_entity_with_no_rule_asks_for_nothing(self):
        """Fails closed rather than inventing a work-up.

        A colloid cyst has no molecular panel, and inventing one would put a
        permanent unmet warning on a finished diagnosis.
        """
        self.assertEqual(neuro_oncology.missing(_tumor(histology="Nang keo")), [])

    def test_a_blank_tumour_says_nothing_at_all(self):
        result = neuro_oncology.assess({})
        self.assertEqual(result["line"], "")
        self.assertFalse(result["integrated"])
        self.assertEqual(result["missing"], [])
        self.assertEqual(result["protocols"]["preferred"], [])


class ProtocolTests(unittest.TestCase):
    def test_glioblastoma_is_offered_stupp_with_its_dose_and_its_paper(self):
        """A regimen name without the schedule is not a protocol.

        The dose, the fractionation and the citation are the part a dropdown
        of drug names leaves out and the part a reader actually needs.
        """
        tumor = _tumor(histology=GBM, grade="4", molecular={"IDH1/2": "Không đột biến (đã giải trình tự)"})
        preferred = neuro_oncology.assess(tumor)["protocols"]["preferred"]
        self.assertEqual(len(preferred), 1)
        self.assertEqual(preferred[0]["id"], "stupp")
        self.assertIn("60 Gy", preferred[0]["detail"])
        self.assertIn("75 mg/m²", preferred[0]["detail"])
        self.assertIn("Stupp", preferred[0]["reference"])

    def test_an_oligodendroglioma_is_offered_rt_plus_pcv(self):
        tumor = _tumor(
            histology=OLIGO, grade="3",
            molecular={"IDH1/2": "Đột biến", "1p/19q": "Đồng mất"},
        )
        preferred = neuro_oncology.assess(tumor)["protocols"]["preferred"]
        self.assertEqual([p["id"] for p in preferred], ["rt_pcv"])

    def test_the_molecular_grade_routes_the_protocol(self):
        """The escalation has to reach treatment, not only the grade badge.

        A grade 2 astrocytoma that CDKN2A/B makes a grade 4 is treated as a
        grade 4. If the route were read off the recorded grade, the escalation
        would be visible on screen and absent from the one place it changes
        what happens to the patient.
        """
        low = _tumor(histology=ASTRO, grade="2", molecular={"IDH1/2": "Đột biến"})
        self.assertEqual(neuro_oncology.route_key(low), "astro_idh_low")

        escalated = _tumor(
            histology=ASTRO, grade="2",
            molecular={"IDH1/2": "Đột biến", "CDKN2A/B": "Mất đồng hợp tử"},
        )
        self.assertEqual(neuro_oncology.route_key(escalated), "astro_idh_g4")

    def test_a_meningioma_routes_on_its_grade(self):
        grade_one = _tumor(histology="U màng não", grade="1")
        self.assertEqual(neuro_oncology.route_key(grade_one), "meningioma_1")

        by_tert = _tumor(histology="U màng não", grade="1", molecular={"TERT promoter": "Đột biến"})
        self.assertEqual(neuro_oncology.route_key(by_tert), "meningioma_3")

    def test_an_unknown_entity_is_offered_nothing(self):
        """A wrong regimen is worse than a blank.

        Somebody handed no protocol looks it up. Somebody handed a plausible
        one for an entity the app never recognised may not.
        """
        tumor = _tumor(histology="U nguyên bào mạch máu", grade="1")
        protocols = neuro_oncology.assess(tumor)["protocols"]
        self.assertEqual(protocols["route"], "")
        self.assertEqual(protocols["preferred"], [])
        self.assertEqual(protocols["conditional"], [])

    def test_typed_english_still_routes(self):
        """A diagnosis typed rather than chosen is recognised where it can be.

        The field accepts free text by design, and a pathology report pasted in
        English is the ordinary case rather than the exotic one.
        """
        self.assertEqual(neuro_oncology.route_key(_tumor(histology="Glioblastoma, IDH-wildtype")), "gbm")

    def test_an_ependymoma_is_not_mistaken_for_a_meningioma(self):
        """One entity name opens with the whole of another.

        "U màng não thất" is an ependymoma and no relation to "U màng não", but
        it begins with every character of it, so a plain substring match handed
        an ependymoma the meningioma route and offered it surgery-and-
        surveillance. Two unrelated tumours, two different operations.
        """
        for wording in ("U màng não thất", "U màng não thất, độ 3", "Ependymoma"):
            tumor = _tumor(histology=wording, grade="2")
            self.assertEqual(neuro_oncology.route_key(tumor), "", wording)
            self.assertEqual(neuro_oncology.protocols_for(tumor)["preferred"], [], wording)

    def test_a_meningioma_still_routes_after_that_guard(self):
        """The veto must not cost the entity the match it was meant to keep."""
        self.assertEqual(
            neuro_oncology.route_key(_tumor(histology="U màng não", grade="2")),
            "meningioma_2",
        )
        self.assertEqual(
            neuro_oncology.route_key(_tumor(histology="Meningioma, WHO grade 1", grade="1")),
            "meningioma_1",
        )

    def test_a_listed_entity_with_no_rule_is_never_matched_loosely(self):
        """Free text is what loose matching is for, and only free text.

        An entity chosen from the list that this file has no rule for is a
        finished diagnosis the app simply does not treat, and the nearest-
        looking answer is the wrong one.
        """
        for wording in ("U nguyên bào mạch máu", "Nang keo", "U sọ hầu"):
            self.assertEqual(neuro_oncology.route_key(_tumor(histology=wording)), "", wording)

        # Listed names that carry a loose needle inside them. Each would have
        # been read as the free text it contains: a MALT lymphoma given the
        # high-dose methotrexate of a diffuse large B-cell one, meningeal
        # spread given radiosurgery.
        for wording in (
            "U lympho MALT màng cứng",
            "U lympho tế bào T và NK/T",
            "U lympho TKTW liên quan suy giảm miễn dịch",
            "Di căn màng não - tuỷ",
        ):
            self.assertIn(wording, clinical_record.HISTOLOGIES, wording)
            self.assertEqual(neuro_oncology.route_key(_tumor(histology=wording)), "", wording)

        # The same words typed off a report are still free text, and still read.
        self.assertEqual(neuro_oncology.route_key(_tumor(histology="U lympho lan toả tế bào B lớn")), "pcnsl")

    def test_the_named_types_under_a_routed_family_keep_its_route(self):
        """Picking the more exact WHO CNS5 name must not cost the protocol the
        family-level name already had."""
        expected = {
            "U nguyên bào tuỷ, hoạt hoá WNT": "medulloblastoma",
            "U nguyên bào tuỷ, hoạt hoá SHH và TP53 tự nhiên": "medulloblastoma",
            "U nguyên bào tuỷ, hoạt hoá SHH và TP53 đột biến": "medulloblastoma",
            "U nguyên bào tuỷ, không WNT/không SHH": "medulloblastoma",
            "U nguyên bào tuỷ, xác định theo mô học": "medulloblastoma",
            "U mầm": "germinoma",
            "Di căn nhu mô não và tuỷ sống": "metastasis",
        }
        for wording, route in expected.items():
            self.assertIn(wording, clinical_record.HISTOLOGIES, wording)
            self.assertEqual(neuro_oncology.route_key(_tumor(histology=wording)), route, wording)

        # A teratoma is a germ cell tumour but not a germinoma: surgery, not
        # the platinum regimen.
        self.assertEqual(neuro_oncology.route_key(_tumor(histology="U quái trưởng thành")), "")

    def test_every_exact_route_and_workup_names_a_listed_entity(self):
        """A key spelled differently from the list is a rule nothing reaches."""
        for name in list(neuro_oncology._EXACT_ROUTES) + list(neuro_oncology.WORKUP):
            self.assertIn(name, clinical_record.HISTOLOGIES, name)

    def test_every_route_names_protocols_that_exist(self):
        """Guards the table against a renamed protocol leaving a dangling id."""
        for key, route in neuro_oncology._ROUTES.items():
            for pid in route["preferred"] + route["conditional"]:
                self.assertIn(pid, neuro_oncology.PROTOCOLS, f"{key} -> {pid}")

    def test_every_protocol_carries_a_reference(self):
        """A recommendation that cannot be checked cannot be argued with."""
        for pid, protocol in neuro_oncology.PROTOCOLS.items():
            self.assertTrue(protocol.get("reference", "").strip(), pid)
            self.assertTrue(protocol.get("detail", "").strip(), pid)


class DisplayTermTests(unittest.TestCase):
    """`display_terms` is what the bilingual check in `test_clinical_record`
    reads, so a sentence this module emits and does not list is a sentence that
    reaches an English screen in Vietnamese with nothing to catch it."""

    #: Tumours chosen to fire every rule that produces a sentence.
    TRIGGERS = (
        # Grade outranked by CDKN2A/B, and by TERT in a meningioma.
        {"histology": ASTRO, "grade": "2",
         "molecular": {"IDH1/2": "Đột biến", "CDKN2A/B": "Mất đồng hợp tử"}},
        {"histology": "U màng não", "grade": "1",
         "molecular": {"TERT promoter": "Đột biến"}},
        # Every contradiction in the table, plus the codeleted astrocytoma.
        {"histology": ASTRO, "grade": "2",
         "molecular": {"IDH1/2": "Không đột biến (đã giải trình tự)"}},
        {"histology": GBM, "grade": "4", "molecular": {"IDH1/2": "Đột biến"}},
        {"histology": OLIGO, "grade": "2", "molecular": {"1p/19q": "Không đồng mất"}},
        {"histology": "U thần kinh đệm lan toả đường giữa, H3 K27 thay đổi", "grade": "4",
         "molecular": {"H3 K27": "Không thay đổi"}},
        {"histology": "U thần kinh đệm lan toả bán cầu, H3 G34 đột biến", "grade": "4",
         "molecular": {"H3 G34": "Không đột biến"}},
        {"histology": ASTRO, "grade": "2",
         "molecular": {"IDH1/2": "Đột biến", "1p/19q": "Đồng mất"}},
        # Every route, so each protocol's name, kind and condition is emitted.
        {"histology": GBM, "grade": "4"},
        {"histology": OLIGO, "grade": "3"},
        {"histology": "U lympho thần kinh trung ương nguyên phát", "grade": ""},
        {"histology": "U di căn", "grade": ""},
        {"histology": "U nguyên bào tuỷ", "grade": "4"},
        {"histology": "U tế bào mầm nội sọ", "grade": ""},
        {"histology": "U sao bào lông", "grade": "1"},
        {"histology": "U màng não", "grade": "3"},
        {"histology": "U bao sợi thần kinh", "grade": "1"},
        {"histology": "U thần kinh đệm lan toả đường giữa, H3 K27 thay đổi", "grade": "4"},
    )

    def test_every_sentence_the_rules_emit_is_listed(self):
        listed = neuro_oncology.display_terms()
        emitted = set()
        for parts in self.TRIGGERS:
            result = neuro_oncology.assess(_tumor(**parts))
            if result["grade"]["rule"]:
                emitted.add(result["grade"]["rule"])
            emitted.update(conflict["text"] for conflict in result["conflicts"])
            for group in ("preferred", "conditional"):
                for protocol in result["protocols"][group]:
                    emitted.add(protocol["name"])
                    emitted.add(protocol["kind"])
                    if protocol.get("when"):
                        emitted.add(protocol["when"])
        # The triggers have to actually trigger, or this passes by saying
        # nothing — which is the one way a coverage test fails silently.
        self.assertGreater(len(emitted), 20)
        self.assertEqual(sorted(emitted - listed), [])

    def test_doses_and_citations_are_deliberately_not_listed(self):
        """They are not translated, so listing them would demand English for a
        dose — and a retyped dose is a transcription error waiting to happen."""
        listed = neuro_oncology.display_terms()
        for protocol in neuro_oncology.PROTOCOLS.values():
            self.assertNotIn(protocol["detail"], listed)
            self.assertNotIn(protocol["reference"], listed)


class RecordTests(unittest.TestCase):
    def test_a_record_is_assessed_tumour_by_tumour_in_order(self):
        record = clinical_record.normalise({
            "tumors": [
                {"histology": GBM, "grade": "4", "basis": "Mô bệnh học",
                 "molecular": {"IDH1/2": "Không đột biến (đã giải trình tự)"}},
                {"histology": "U màng não", "grade": "1", "basis": "Mô bệnh học"},
            ],
        })
        assessed = neuro_oncology.assess_record(record)
        self.assertEqual(len(assessed), 2)
        self.assertEqual(assessed[0]["protocols"]["route"], "gbm")
        self.assertEqual(assessed[1]["protocols"]["route"], "meningioma_1")

    def test_a_record_with_no_tumours_assesses_to_nothing(self):
        self.assertEqual(neuro_oncology.assess_record(clinical_record.empty_record()), [])
        self.assertEqual(neuro_oncology.assess_record(None), [])

    def test_the_marker_values_the_record_stores_survive_normalisation(self):
        """The listed answers have to come back out of storage unchanged.

        The rules compare exactly, so a result the record truncates or trims
        into a different string is a result that silently stops firing.
        """
        record = clinical_record.normalise({
            "tumors": [{
                "histology": ASTRO, "grade": "2", "basis": "Mô bệnh học",
                "molecular": {
                    "IDH1/2": "Đột biến",
                    "CDKN2A/B": "Mất đồng hợp tử",
                    "ATRX": "Mất biểu hiện",
                },
            }],
        })
        self.assertEqual(neuro_oncology.assess_record(record)[0]["grade"]["grade"], "4")


if __name__ == "__main__":
    unittest.main()
